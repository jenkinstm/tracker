import { z } from 'zod';

import { type IsoDate, isIsoDate, isoToDateColumn, shiftIsoDate } from './date.js';
import { roundTo } from './round.js';

/**
 * Тренд, темп и прогноз по весу (FR-4.2, FR-4.4, FR-4.5).
 *
 * Главное правило всего файла: окна считаются в КАЛЕНДАРНЫХ ДНЯХ, а не
 * в замерах. «Последние 7 замеров» и «последние 7 дней» — разные вещи, и при
 * разрывах в данных первое врёт: взвесился в понедельник и в пятницу — это
 * два замера за пять дней, а не за два. Регрессия по той же причине строится
 * по фактическим датам, а не по индексам массива (критерий приёмки №6).
 */

export type Measurement = { date: IsoDate; kg: number };

/** Окно сглаживания и коэффициент EMA из docs/context.md. */
export const TREND_WINDOW_DAYS = 7;
export const EMA_ALPHA = 0.25;

/** Окно регрессии и минимум замеров в нём (FR-4.4). */
export const RATE_WINDOW_DAYS = 21;
export const MIN_RATE_MEASUREMENTS = 4;

/** Число дней между датами; отрицательное, если вторая раньше первой. */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  const ms = isoToDateColumn(to).getTime() - isoToDateColumn(from).getTime();
  return Math.round(ms / 86_400_000);
}

function sortByDate(measurements: readonly Measurement[]): Measurement[] {
  return [...measurements].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Один замер на дату (FR-4.1). На случай, если в выборку попали дубли:
 * побеждает последний — так же, как повторная запись перезаписывает.
 */
function dedupeByDate(measurements: readonly Measurement[]): Measurement[] {
  const byDate = new Map<IsoDate, number>();
  for (const m of measurements) byDate.set(m.date, m.kg);

  return [...byDate.entries()]
    .map(([date, kg]) => ({ date, kg }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export type TrendPoint = {
  date: IsoDate;
  /** Сырой замер этого дня, если он был. */
  kg: number | null;
  /** Скользящее среднее за 7 календарных дней; null, если окно пустое. */
  average: number | null;
  /** EMA поверх среднего — это и есть тренд, который показывается человеку. */
  trend: number | null;
};

/**
 * Тренд по дням: от первого замера до последнего, без дыр в шкале.
 *
 * Дни без замеров остаются в ряду — иначе на графике разрыв в неделю
 * выглядел бы как один день, а тренд считался бы по сжатому времени.
 */
export function calcTrendSeries(measurements: readonly Measurement[]): TrendPoint[] {
  const sorted = dedupeByDate(measurements);
  if (sorted.length === 0) return [];

  const byDate = new Map(sorted.map((m) => [m.date, m.kg]));
  const first = sorted[0]!.date;
  const last = sorted[sorted.length - 1]!.date;

  const points: TrendPoint[] = [];
  let ema: number | null = null;

  for (let offset = 0; offset <= daysBetween(first, last); offset += 1) {
    const date = shiftIsoDate(first, offset);

    // Окно [date-6; date] по календарю, а не по последним семи записям.
    const windowStart = shiftIsoDate(date, -(TREND_WINDOW_DAYS - 1));
    const inWindow = sorted.filter((m) => m.date >= windowStart && m.date <= date);

    const average =
      inWindow.length === 0
        ? null
        : roundTo(inWindow.reduce((sum, m) => sum + m.kg, 0) / inWindow.length, 3);

    // Пустое окно не сбрасывает EMA: значение переносится, пока не появятся
    // новые данные. Обнулять тренд из-за пропуска взвешиваний — врать.
    if (average !== null) {
      ema = ema === null ? average : EMA_ALPHA * average + (1 - EMA_ALPHA) * ema;
    }

    points.push({
      date,
      kg: byDate.get(date) ?? null,
      average,
      trend: ema === null ? null : roundTo(ema, 3),
    });
  }

  return points;
}

/** Текущий тренд — последнее значение ряда. Это то, что видно на главном. */
export function calcCurrentTrend(measurements: readonly Measurement[]): number | null {
  const series = calcTrendSeries(measurements);
  return series.length === 0 ? null : (series[series.length - 1]!.trend ?? null);
}

/**
 * Темп в кг/неделю: линейная регрессия по замерам за последние 21 день,
 * наклон × 7 (FR-4.4). Отрицательное значение — вес снижается.
 *
 * `asOf` задаёт правый край окна: темп «на сегодня», а не «на день последнего
 * взвешивания», иначе после недели без весов показывался бы устаревший темп.
 */
export function calcRate(
  measurements: readonly Measurement[],
  asOf: IsoDate,
  windowDays = RATE_WINDOW_DAYS,
): number | null {
  const windowStart = shiftIsoDate(asOf, -(windowDays - 1));
  const inWindow = dedupeByDate(measurements).filter(
    (m) => m.date >= windowStart && m.date <= asOf,
  );

  if (inWindow.length < MIN_RATE_MEASUREMENTS) return null;

  // x — дни от начала окна, а не порядковый номер замера.
  const points = inWindow.map((m) => ({ x: daysBetween(windowStart, m.date), y: m.kg }));

  const n = points.length;
  const meanX = points.reduce((sum, p) => sum + p.x, 0) / n;
  const meanY = points.reduce((sum, p) => sum + p.y, 0) / n;

  const denominator = points.reduce((sum, p) => sum + (p.x - meanX) ** 2, 0);
  // Все замеры в один день: наклон не определён, делить нельзя.
  if (denominator === 0) return null;

  const numerator = points.reduce((sum, p) => sum + (p.x - meanX) * (p.y - meanY), 0);

  return roundTo((numerator / denominator) * 7, 3);
}

/** Насколько близко к цели считаем, что она достигнута. */
const GOAL_TOLERANCE_KG = 0.2;
/** Ниже этого темпа движение неотличимо от шума весов. */
const STALLED_RATE_KG_PER_WEEK = 0.05;

export type Forecast =
  | { kind: 'NO_DATA' }
  | { kind: 'REACHED' }
  /** Темп есть, но ведёт в сторону от цели. */
  | { kind: 'WRONG_DIRECTION'; ratePerWeek: number }
  /** Вес стоит: делить на такой темп — получать бесконечность. */
  | { kind: 'STALLED' }
  | { kind: 'ETA'; date: IsoDate; weeks: number };

/**
 * Прогноз даты достижения цели (FR-4.5): (тренд − цель) / |темп| недель.
 *
 * Возвращается размеченный результат, а не число: «цель уже достигнута»,
 * «вес идёт в другую сторону» и «данных не хватает» — разные ситуации,
 * и показывать их одинаковым прочерком нельзя.
 */
export function calcForecast(input: {
  trend: number | null;
  goalKg: number | null;
  ratePerWeek: number | null;
  today: IsoDate;
}): Forecast {
  const { trend, goalKg, ratePerWeek, today } = input;

  if (trend === null || goalKg === null) return { kind: 'NO_DATA' };

  const remainingKg = trend - goalKg;
  if (Math.abs(remainingKg) <= GOAL_TOLERANCE_KG) return { kind: 'REACHED' };

  if (ratePerWeek === null) return { kind: 'NO_DATA' };
  if (Math.abs(ratePerWeek) < STALLED_RATE_KG_PER_WEEK) return { kind: 'STALLED' };

  // Знаки должны быть противоположны: цель ниже (remaining > 0) — темп
  // обязан быть отрицательным, и наоборот.
  const movingToGoal = remainingKg > 0 ? ratePerWeek < 0 : ratePerWeek > 0;
  if (!movingToGoal) return { kind: 'WRONG_DIRECTION', ratePerWeek };

  const weeks = Math.abs(remainingKg) / Math.abs(ratePerWeek);

  return {
    kind: 'ETA',
    date: shiftIsoDate(today, Math.round(weeks * 7)),
    weeks: roundTo(weeks, 1),
  };
}

/** Темп в процентах от массы тела — целевой коридор из context.md 0.5–1.0 %/нед. */
export function ratePercentOfBody(ratePerWeek: number | null, trend: number | null): number | null {
  if (ratePerWeek === null || trend === null || trend <= 0) return null;
  return roundTo((Math.abs(ratePerWeek) / trend) * 100, 2);
}

/** Замеры за период — для графика с переключением 30 / 90 / 365 дней. */
export function filterFromDate(
  measurements: readonly Measurement[],
  from: IsoDate,
): Measurement[] {
  return sortByDate(measurements).filter((m) => m.date >= from);
}

// ─────────────────────────────────────────── контракт API

export const weightUpsertSchema = z.object({
  date: z.string().refine(isIsoDate, 'дата в формате ГГГГ-ММ-ДД'),
  kg: z.number().min(20).max(500),
});

export type WeightUpsert = z.infer<typeof weightUpsertSchema>;

/** Периоды графика (FR-4.3). `null` — всё время. */
export const CHART_PERIODS = [30, 90, 365, null] as const;
export type ChartPeriod = (typeof CHART_PERIODS)[number];

export type WeightStats = {
  /** Сглаженный тренд — то, что показывается вместо сырой цифры (FR-4.2). */
  trend: number | null;
  /** Последний сырой замер и его дата. */
  latest: Measurement | null;
  startWeight: number | null;
  goalWeight: number | null;
  ratePerWeek: number | null;
  ratePercent: number | null;
  /** Попадает ли темп в коридор 0.5–1.0 % массы тела из context.md. */
  rateInCorridor: boolean | null;
  forecast: Forecast;
  /** Сколько килограммов пройдено от старта и сколько осталось до цели. */
  lostKg: number | null;
  toGoalKg: number | null;
};

export type WeightSeriesResponse = {
  points: TrendPoint[];
  stats: WeightStats;
};

/** Целевой коридор снижения из docs/context.md, % массы тела в неделю. */
export const RATE_CORRIDOR = { min: 0.5, max: 1.0 } as const;

export function isRateInCorridor(ratePercent: number | null): boolean | null {
  if (ratePercent === null) return null;
  return ratePercent >= RATE_CORRIDOR.min && ratePercent <= RATE_CORRIDOR.max;
}
