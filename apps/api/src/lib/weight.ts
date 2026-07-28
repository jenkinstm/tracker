import {
  type IsoDate,
  type Measurement,
  type WeightSeriesResponse,
  type WeightStats,
  calcCurrentTrend,
  calcForecast,
  calcRate,
  calcTrendSeries,
  dateColumnToIso,
  isRateInCorridor,
  isoToDateColumn,
  ratePercentOfBody,
  roundTo,
  todayIso,
} from '@tracker/shared';

import { prisma } from '../db.js';

export async function listMeasurements(
  userId: string,
  from?: IsoDate,
  to?: IsoDate,
): Promise<Measurement[]> {
  const rows = await prisma.weight.findMany({
    where: {
      userId,
      date: {
        ...(from ? { gte: isoToDateColumn(from) } : {}),
        ...(to ? { lte: isoToDateColumn(to) } : {}),
      },
    },
    orderBy: { date: 'asc' },
  });

  return rows.map((row) => ({ date: dateColumnToIso(row.date), kg: row.kg }));
}

/** Одна запись на дату: повторная перезаписывает (FR-4.1). */
export async function upsertWeight(userId: string, date: IsoDate, kg: number): Promise<void> {
  const key = { userId, date: isoToDateColumn(date) };

  await prisma.weight.upsert({
    where: { userId_date: key },
    create: { ...key, kg },
    update: { kg },
  });
}

export async function deleteWeight(userId: string, date: IsoDate): Promise<boolean> {
  const key = { userId, date: isoToDateColumn(date) };

  const deleted = await prisma.weight.deleteMany({ where: key });
  return deleted.count > 0;
}

/**
 * Тренд, темп и прогноз (FR-4.2, FR-4.4, FR-4.5).
 *
 * Считается по всей истории, а не по выбранному на графике периоду: окно
 * сглаживания в 7 дней и окно регрессии в 21 день должны видеть замеры
 * за границей периода, иначе при переключении на «30 дней» тренд в начале
 * графика пересчитался бы с нуля.
 */
export async function getWeightStats(
  userId: string,
  today: IsoDate = todayIso(),
): Promise<WeightSeriesResponse> {
  const [measurements, profile] = await Promise.all([
    listMeasurements(userId),
    prisma.profile.findUnique({ where: { userId } }),
  ]);

  const points = calcTrendSeries(measurements);
  const trend = calcCurrentTrend(measurements);
  const ratePerWeek = calcRate(measurements, today);
  const ratePercent = ratePercentOfBody(ratePerWeek, trend);

  const latest = measurements.length === 0 ? null : measurements[measurements.length - 1]!;
  const goalWeight = profile?.goalWeight ?? null;
  const startWeight = profile?.startWeight ?? null;

  const stats: WeightStats = {
    trend,
    latest,
    startWeight,
    goalWeight,
    ratePerWeek,
    ratePercent,
    rateInCorridor: isRateInCorridor(ratePercent),
    forecast: calcForecast({ trend, goalKg: goalWeight, ratePerWeek, today }),
    // От старта считаем по тренду: сравнивать сырой замер со стартовым весом
    // значит подмешивать в результат воду и соль конкретного утра.
    lostKg: startWeight !== null && trend !== null ? roundTo(startWeight - trend, 1) : null,
    toGoalKg: goalWeight !== null && trend !== null ? roundTo(trend - goalWeight, 1) : null,
  };

  return { points, stats };
}
