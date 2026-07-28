import { describe, expect, it } from 'vitest';

import {
  type Measurement,
  calcCurrentTrend,
  calcForecast,
  calcRate,
  calcTrendSeries,
  daysBetween,
  filterFromDate,
  ratePercentOfBody,
} from './weight.js';

/** Ряд подряд идущих дней от указанной даты. */
function daily(start: string, weights: number[]): Measurement[] {
  return weights.map((kg, index) => {
    const date = new Date(`${start}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + index);
    return { date: date.toISOString().slice(0, 10), kg };
  });
}

describe('daysBetween', () => {
  it('считает дни между датами', () => {
    expect(daysBetween('2026-01-01', '2026-01-08')).toBe(7);
    expect(daysBetween('2026-01-08', '2026-01-01')).toBe(-7);
    expect(daysBetween('2026-01-01', '2026-01-01')).toBe(0);
  });

  it('не спотыкается о переход через месяц и год', () => {
    expect(daysBetween('2026-01-31', '2026-02-01')).toBe(1);
    expect(daysBetween('2025-12-31', '2026-01-01')).toBe(1);
  });

  it('не спотыкается о високосный февраль', () => {
    expect(daysBetween('2024-02-28', '2024-03-01')).toBe(2);
    expect(daysBetween('2026-02-28', '2026-03-01')).toBe(1);
  });
});

describe('calcTrendSeries', () => {
  it('без замеров ряда нет', () => {
    expect(calcTrendSeries([])).toEqual([]);
  });

  it('один замер: тренд равен ему самому', () => {
    const series = calcTrendSeries([{ date: '2026-01-01', kg: 100 }]);

    expect(series).toHaveLength(1);
    expect(series[0]).toEqual({ date: '2026-01-01', kg: 100, average: 100, trend: 100 });
  });

  it('два замера подряд: среднее и EMA считаются по формуле', () => {
    const series = calcTrendSeries(daily('2026-01-01', [100, 98]));

    expect(series[0]!.average).toBe(100);
    expect(series[0]!.trend).toBe(100);
    // Среднее за два дня 99, EMA = 0.25×99 + 0.75×100.
    expect(series[1]!.average).toBe(99);
    expect(series[1]!.trend).toBe(99.75);
  });

  it('тренд сглаживает единичный выброс', () => {
    // Скачок на 2 кг за сутки — это соль и вода, а не жир.
    const series = calcTrendSeries(daily('2026-01-01', [100, 100, 100, 102, 100]));
    const last = series[series.length - 1]!;

    expect(last.kg).toBe(100);
    expect(last.trend).toBeGreaterThan(100);
    expect(last.trend).toBeLessThan(100.5);
  });

  // Критерий приёмки №6: пропущенные дни не должны искажать тренд.
  describe('разрывы в данных', () => {
    const gapped: Measurement[] = [
      { date: '2026-01-01', kg: 100 },
      { date: '2026-01-10', kg: 98 },
    ];

    it('ряд идёт по календарю, а не по замерам', () => {
      const series = calcTrendSeries(gapped);

      expect(series).toHaveLength(10);
      expect(series[0]!.date).toBe('2026-01-01');
      expect(series[9]!.date).toBe('2026-01-10');
    });

    it('дни без замеров остаются в ряду с пустым kg', () => {
      const series = calcTrendSeries(gapped);

      expect(series[4]!.kg).toBeNull();
      expect(series[9]!.kg).toBe(98);
    });

    it('окно за пределами замеров даёт пустое среднее', () => {
      const series = calcTrendSeries(gapped);

      // 8 января: окно 2–8 января, замеров в нём нет.
      expect(series[7]!.date).toBe('2026-01-08');
      expect(series[7]!.average).toBeNull();
    });

    it('пропуск переносит прошлый тренд, а не обнуляет его', () => {
      const series = calcTrendSeries(gapped);

      expect(series[7]!.trend).toBe(100);
    });

    it('после пропуска тренд подхватывает новый замер', () => {
      const series = calcTrendSeries(gapped);

      // 0.25×98 + 0.75×100
      expect(series[9]!.trend).toBe(99.5);
    });

    it('разрыв не сжимает шкалу: тренд отстаёт от сырого веса', () => {
      const series = calcTrendSeries(gapped);
      const last = series[series.length - 1]!;

      expect(last.kg).toBe(98);
      expect(last.trend).toBeGreaterThan(98);
    });
  });

  it('замеры принимаются в любом порядке', () => {
    const shuffled: Measurement[] = [
      { date: '2026-01-03', kg: 99 },
      { date: '2026-01-01', kg: 100 },
      { date: '2026-01-02', kg: 99.5 },
    ];

    expect(calcTrendSeries(shuffled).map((p) => p.date)).toEqual([
      '2026-01-01',
      '2026-01-02',
      '2026-01-03',
    ]);
  });

  it('дубль по дате не удваивает вес в среднем', () => {
    const withDuplicate: Measurement[] = [
      { date: '2026-01-01', kg: 100 },
      { date: '2026-01-01', kg: 90 },
    ];
    const series = calcTrendSeries(withDuplicate);

    expect(series).toHaveLength(1);
    expect(series[0]!.average).toBe(90); // побеждает последний, как при перезаписи
  });
});

describe('calcCurrentTrend', () => {
  it('без замеров тренда нет', () => {
    expect(calcCurrentTrend([])).toBeNull();
  });

  it('возвращает последнее значение ряда', () => {
    expect(calcCurrentTrend(daily('2026-01-01', [100, 98]))).toBe(99.75);
  });
});

describe('calcRate', () => {
  it('линейное снижение даёт ровный темп', () => {
    // По 0.5 кг в день на четырёх замерах — это 3.5 кг в неделю.
    const rate = calcRate(daily('2026-01-01', [100, 99.5, 99, 98.5]), '2026-01-04');
    expect(rate).toBe(-3.5);
  });

  it('набор веса даёт положительный темп', () => {
    expect(calcRate(daily('2026-01-01', [98.5, 99, 99.5, 100]), '2026-01-04')).toBe(3.5);
  });

  it('неизменный вес даёт нулевой темп, а не null', () => {
    expect(calcRate(daily('2026-01-01', [100, 100, 100, 100]), '2026-01-04')).toBe(0);
  });

  it('меньше четырёх замеров — темп не считаем (FR-4.4)', () => {
    expect(calcRate([], '2026-01-04')).toBeNull();
    expect(calcRate(daily('2026-01-01', [100]), '2026-01-04')).toBeNull();
    expect(calcRate(daily('2026-01-01', [100, 99]), '2026-01-04')).toBeNull();
    expect(calcRate(daily('2026-01-01', [100, 99, 98]), '2026-01-04')).toBeNull();
  });

  it('ровно четыре замера — уже считаем', () => {
    expect(calcRate(daily('2026-01-01', [100, 99, 98, 97]), '2026-01-04')).not.toBeNull();
  });

  it('дубли по дате схлопываются и не добирают порог', () => {
    const withDuplicates: Measurement[] = [
      { date: '2026-01-01', kg: 100 },
      { date: '2026-01-01', kg: 100 },
      { date: '2026-01-02', kg: 99 },
      { date: '2026-01-02', kg: 99 },
    ];
    // Дат всего две — для регрессии этого мало, сколько бы строк ни пришло.
    expect(calcRate(withDuplicates, '2026-01-02')).toBeNull();
  });

  it('замеры старше окна не участвуют', () => {
    const old = daily('2026-01-01', [100, 99, 98, 97]);
    // Окно 21 день назад от 1 марта — январь в него не попадает.
    expect(calcRate(old, '2026-03-01')).toBeNull();
  });

  it('замеры позже asOf не участвуют: темп считается на дату, а не «вообще»', () => {
    const measurements = daily('2026-01-01', [100, 99, 98, 97]);
    expect(calcRate(measurements, '2026-01-02')).toBeNull();
  });

  // Критерий приёмки №6: регрессия должна идти по датам, а не по индексам.
  it('разрыв в датах не завышает темп', () => {
    const gapped: Measurement[] = [
      { date: '2026-01-01', kg: 100 },
      { date: '2026-01-02', kg: 100 },
      { date: '2026-01-03', kg: 100 },
      { date: '2026-01-21', kg: 90 },
    ];

    const rate = calcRate(gapped, '2026-01-21');

    // По датам: около −3.66 кг/нед. По индексам массива вышло бы −21 —
    // шкала сжалась бы с 20 дней до трёх.
    expect(rate).toBeCloseTo(-3.657, 3);
    expect(rate).toBeGreaterThan(-5);
  });

  it('окно настраивается', () => {
    const measurements = daily('2026-01-01', [100, 99.5, 99, 98.5]);
    expect(calcRate(measurements, '2026-01-04', 2)).toBeNull(); // в двух днях только 2 замера
    expect(calcRate(measurements, '2026-01-04', 4)).toBe(-3.5);
  });
});

describe('calcForecast', () => {
  const today = '2026-01-01';

  it('без тренда или цели прогноза нет', () => {
    expect(calcForecast({ trend: null, goalKg: 90, ratePerWeek: -1, today })).toEqual({
      kind: 'NO_DATA',
    });
    expect(calcForecast({ trend: 100, goalKg: null, ratePerWeek: -1, today })).toEqual({
      kind: 'NO_DATA',
    });
  });

  it('без темпа прогноза нет', () => {
    expect(calcForecast({ trend: 100, goalKg: 90, ratePerWeek: null, today })).toEqual({
      kind: 'NO_DATA',
    });
  });

  it('цель достигнута', () => {
    expect(calcForecast({ trend: 90, goalKg: 90, ratePerWeek: -1, today })).toEqual({
      kind: 'REACHED',
    });
  });

  it('попадание в пределах допуска считается достижением', () => {
    expect(calcForecast({ trend: 90.15, goalKg: 90, ratePerWeek: -1, today })).toEqual({
      kind: 'REACHED',
    });
  });

  it('стоячий вес не превращается в бесконечный прогноз', () => {
    expect(calcForecast({ trend: 100, goalKg: 90, ratePerWeek: 0, today })).toEqual({
      kind: 'STALLED',
    });
    expect(calcForecast({ trend: 100, goalKg: 90, ratePerWeek: -0.01, today })).toEqual({
      kind: 'STALLED',
    });
  });

  it('движение в сторону от цели не выдаётся датой', () => {
    expect(calcForecast({ trend: 100, goalKg: 90, ratePerWeek: 0.5, today })).toEqual({
      kind: 'WRONG_DIRECTION',
      ratePerWeek: 0.5,
    });
  });

  it('снижение при цели выше текущего веса — тоже не туда', () => {
    expect(calcForecast({ trend: 60, goalKg: 70, ratePerWeek: -0.5, today })).toEqual({
      kind: 'WRONG_DIRECTION',
      ratePerWeek: -0.5,
    });
  });

  it('считает дату по формуле (тренд − цель) / |темп|', () => {
    // 10 кг при 0.5 кг/нед — 20 недель, это 140 дней.
    expect(calcForecast({ trend: 100, goalKg: 90, ratePerWeek: -0.5, today })).toEqual({
      kind: 'ETA',
      date: '2026-05-21',
      weeks: 20,
    });
  });

  it('работает и на набор веса к цели выше текущей', () => {
    const forecast = calcForecast({ trend: 60, goalKg: 70, ratePerWeek: 0.5, today });
    expect(forecast).toEqual({ kind: 'ETA', date: '2026-05-21', weeks: 20 });
  });
});

describe('ratePercentOfBody', () => {
  it('переводит темп в проценты массы тела', () => {
    expect(ratePercentOfBody(-1, 100)).toBe(1);
    expect(ratePercentOfBody(-0.62, 124)).toBe(0.5);
  });

  it('знак темпа не влияет на долю', () => {
    expect(ratePercentOfBody(1, 100)).toBe(1);
  });

  it('без темпа или веса доли нет', () => {
    expect(ratePercentOfBody(null, 100)).toBeNull();
    expect(ratePercentOfBody(-1, null)).toBeNull();
    expect(ratePercentOfBody(-1, 0)).toBeNull();
  });
});

describe('filterFromDate', () => {
  const measurements = daily('2026-01-01', [100, 99, 98, 97, 96]);

  it('оставляет замеры от даты включительно', () => {
    expect(filterFromDate(measurements, '2026-01-03')).toHaveLength(3);
  });

  it('на пустом наборе не падает', () => {
    expect(filterFromDate([], '2026-01-03')).toEqual([]);
  });

  it('возвращает замеры по возрастанию даты', () => {
    const shuffled = [...measurements].reverse();
    expect(filterFromDate(shuffled, '2026-01-01').map((m) => m.date)).toEqual(
      measurements.map((m) => m.date),
    );
  });
});
