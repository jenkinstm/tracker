import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SET_COUNT,
  countDoneSets,
  duplicateLastSet,
  prefillSets,
  stepReps,
  stepWeight,
  weightStep,
  workoutVolume,
} from './workout.js';

describe('prefillSets', () => {
  it('без истории берёт план программы', () => {
    const sets = prefillSets({ targetSets: 4, targetReps: 10 });

    expect(sets).toHaveLength(4);
    expect(sets[0]).toEqual({ setIndex: 1, weightKg: null, reps: 10, source: 'PROGRAM' });
    expect(sets[3]!.setIndex).toBe(4);
  });

  it('прошлый раз важнее плана: вес подставляется из истории', () => {
    const lastTime = [
      { weightKg: 60, reps: 10 },
      { weightKg: 60, reps: 9 },
    ];
    const sets = prefillSets({ lastTime, targetSets: 2, targetReps: 12 });

    expect(sets[0]).toEqual({ setIndex: 1, weightKg: 60, reps: 10, source: 'LAST_TIME' });
    expect(sets[1]!.reps).toBe(9);
  });

  it('подходов в прошлый раз было меньше — недостающие тянут последний', () => {
    const lastTime = [
      { weightKg: 60, reps: 10 },
      { weightKg: 65, reps: 8 },
    ];
    const sets = prefillSets({ lastTime, targetSets: 4 });

    expect(sets).toHaveLength(4);
    expect(sets[2]).toEqual({ setIndex: 3, weightKg: 65, reps: 8, source: 'LAST_TIME' });
    expect(sets[3]).toEqual({ setIndex: 4, weightKg: 65, reps: 8, source: 'LAST_TIME' });
  });

  it('подходов в прошлый раз было больше — берём столько, сколько в плане', () => {
    const lastTime = [
      { weightKg: 60, reps: 10 },
      { weightKg: 60, reps: 10 },
      { weightKg: 60, reps: 10 },
      { weightKg: 60, reps: 10 },
      { weightKg: 60, reps: 10 },
    ];

    expect(prefillSets({ lastTime, targetSets: 3 })).toHaveLength(3);
  });

  it('без плана число подходов берётся из истории', () => {
    const lastTime = [
      { weightKg: 20, reps: 12 },
      { weightKg: 20, reps: 12 },
    ];

    expect(prefillSets({ lastTime })).toHaveLength(2);
  });

  it('ни плана, ни истории — три подхода по умолчанию', () => {
    const sets = prefillSets({});

    expect(sets).toHaveLength(DEFAULT_SET_COUNT);
    expect(sets[0]).toEqual({ setIndex: 1, weightKg: null, reps: null, source: 'EMPTY' });
  });

  it('вес тела: null сохраняется и не превращается в ноль', () => {
    const lastTime = [
      { weightKg: null, reps: 20 },
      { weightKg: null, reps: 18 },
    ];
    const sets = prefillSets({ lastTime, targetSets: 2 });

    expect(sets[0]!.weightKg).toBeNull();
    expect(sets[0]!.reps).toBe(20);
  });

  it('недоделанный прошлый раз всё равно годится как источник', () => {
    // Подход без повторов — человек бросил тренировку на середине.
    const lastTime = [
      { weightKg: 60, reps: 10 },
      { weightKg: 60, reps: null },
    ];
    const sets = prefillSets({ lastTime, targetSets: 2, targetReps: 12 });

    expect(sets[1]!.weightKg).toBe(60);
    expect(sets[1]!.reps).toBe(12); // повторов в истории нет — берём план
  });

  it('мусорные цели не ломают расчёт', () => {
    expect(prefillSets({ targetSets: 0, targetReps: 10 })).toHaveLength(DEFAULT_SET_COUNT);
    expect(prefillSets({ targetSets: -3 })).toHaveLength(DEFAULT_SET_COUNT);
    expect(prefillSets({ targetSets: Number.NaN })).toHaveLength(DEFAULT_SET_COUNT);
    expect(prefillSets({ targetSets: 2, targetReps: 0 })[0]!.reps).toBeNull();
  });

  it('дробное число подходов округляется', () => {
    expect(prefillSets({ targetSets: 3.6 })).toHaveLength(4);
  });

  it('нумерация подходов идёт с единицы и без дыр', () => {
    const sets = prefillSets({ targetSets: 5 });
    expect(sets.map((s) => s.setIndex)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('duplicateLastSet', () => {
  it('дублирует последний подход и увеличивает номер', () => {
    const sets = [
      { setIndex: 1, weightKg: 60, reps: 10 },
      { setIndex: 2, weightKg: 65, reps: 8 },
    ];

    expect(duplicateLastSet(sets)).toEqual({
      setIndex: 3,
      weightKg: 65,
      reps: 8,
      source: 'LAST_TIME',
    });
  });

  it('порядок в массиве не влияет: берётся наибольший номер', () => {
    const shuffled = [
      { setIndex: 2, weightKg: 65, reps: 8 },
      { setIndex: 1, weightKg: 60, reps: 10 },
    ];

    expect(duplicateLastSet(shuffled).weightKg).toBe(65);
  });

  it('на пустом списке даёт первый пустой подход', () => {
    expect(duplicateLastSet([])).toEqual({
      setIndex: 1,
      weightKg: null,
      reps: null,
      source: 'EMPTY',
    });
  });
});

describe('workoutVolume', () => {
  it('считает вес × повторы по выполненным подходам', () => {
    expect(
      workoutVolume([
        { weightKg: 60, reps: 10, done: true },
        { weightKg: 60, reps: 8, done: true },
      ]),
    ).toBe(1080);
  });

  it('невыполненные подходы в объём не идут: план — не работа', () => {
    expect(
      workoutVolume([
        { weightKg: 60, reps: 10, done: true },
        { weightKg: 60, reps: 10, done: false },
      ]),
    ).toBe(600);
  });

  it('упражнения с весом тела объём не дают', () => {
    expect(workoutVolume([{ weightKg: null, reps: 20, done: true }])).toBe(0);
  });

  it('подход без повторов не считается', () => {
    expect(workoutVolume([{ weightKg: 60, reps: null, done: true }])).toBe(0);
  });

  it('пустая тренировка — ноль', () => {
    expect(workoutVolume([])).toBe(0);
  });

  it('дробный вес не даёт хвоста из-за плавающей точки', () => {
    expect(workoutVolume([{ weightKg: 22.5, reps: 3, done: true }])).toBe(67.5);
  });
});

describe('countDoneSets', () => {
  it('считает отмеченные', () => {
    expect(countDoneSets([{ done: true }, { done: false }, { done: true }])).toBe(2);
  });

  it('пустой список — ноль', () => {
    expect(countDoneSets([])).toBe(0);
  });
});

describe('weightStep', () => {
  it('у штанги шаг 2.5 кг: блины кладутся парами', () => {
    expect(weightStep('BARBELL')).toBe(2.5);
  });

  it('гантели и мешок ходят по килограмму', () => {
    expect(weightStep('DUMBBELL')).toBe(1);
    expect(weightStep('SANDBAG')).toBe(1);
  });

  it('остальное — мелкий шаг', () => {
    expect(weightStep('BAND')).toBe(0.5);
    expect(weightStep('BODYWEIGHT')).toBe(0.5);
  });
});

describe('stepWeight', () => {
  it('прибавляет и убавляет шаг', () => {
    expect(stepWeight(60, 1, 2.5)).toBe(62.5);
    expect(stepWeight(60, -1, 2.5)).toBe(57.5);
  });

  it('от пустого веса начинает с нуля', () => {
    expect(stepWeight(null, 1, 2.5)).toBe(2.5);
  });

  it('ниже нуля не уходит', () => {
    expect(stepWeight(1, -1, 2.5)).toBe(0);
    expect(stepWeight(0, -1, 2.5)).toBe(0);
    expect(stepWeight(null, -1, 2.5)).toBe(0);
  });

  it('не копит хвост на дробном шаге', () => {
    expect(stepWeight(0.1, 1, 0.2)).toBe(0.3);
  });
});

describe('stepReps', () => {
  it('прибавляет и убавляет по одному', () => {
    expect(stepReps(10, 1)).toBe(11);
    expect(stepReps(10, -1)).toBe(9);
  });

  it('от пустого значения начинает с нуля', () => {
    expect(stepReps(null, 1)).toBe(1);
  });

  it('ниже нуля не уходит', () => {
    expect(stepReps(0, -1)).toBe(0);
  });
});
