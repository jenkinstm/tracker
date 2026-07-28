import { describe, expect, it } from 'vitest';

import {
  BACKUP_VERSION,
  type Backup,
  backupCounts,
  backupSchema,
  isSupportedVersion,
  totalRecords,
} from './backup.js';

const EMPTY: Backup = {
  version: BACKUP_VERSION,
  exportedAt: '2026-07-28T12:00:00.000Z',
  profile: null,
  foods: [],
  foodUnits: [],
  recipes: [],
  recipeItems: [],
  diaryEntries: [],
  mealTemplates: [],
  weights: [],
  measurements: [],
  photos: [],
  exercises: [],
  programs: [],
  programItems: [],
  workouts: [],
  workoutSets: [],
  activities: [],
  daily: [],
  reminders: [],
};

describe('backupSchema', () => {
  it('пустая выгрузка проходит валидацию', () => {
    expect(backupSchema.safeParse(EMPTY).success).toBe(true);
  });

  it('выгрузка с данными проходит валидацию', () => {
    const backup: Backup = {
      ...EMPTY,
      weights: [{ date: '2026-07-28', kg: 124 }],
      diaryEntries: [
        {
          id: 'e1',
          date: '2026-07-28',
          time: '13:00',
          foodId: 'seed:buckwheat-boiled',
          recipeId: null,
          name: 'Гречка варёная',
          grams: 200,
          kcal: 184,
          protein: 6.8,
          fat: 1.2,
          carb: 34.2,
          isSweet: false,
          mealType: 'LUNCH',
          isEstimate: false,
        },
      ],
    };

    expect(backupSchema.safeParse(backup).success).toBe(true);
  });

  it('обрезанный файл не принимается за выгрузку', () => {
    expect(backupSchema.safeParse({ version: 1 }).success).toBe(false);
    expect(backupSchema.safeParse({}).success).toBe(false);
    expect(backupSchema.safeParse(null).success).toBe(false);
  });

  // Молча пропустить незнакомое поле — значит потерять историю.
  it('запись дневника без калорий не принимается', () => {
    const broken = {
      ...EMPTY,
      diaryEntries: [{ id: 'e1', date: '2026-07-28', time: '13:00', name: 'Еда' }],
    };

    expect(backupSchema.safeParse(broken).success).toBe(false);
  });
});

describe('isSupportedVersion', () => {
  it('текущая версия поддерживается', () => {
    expect(isSupportedVersion(BACKUP_VERSION)).toBe(true);
  });

  it('выгрузка из будущего не читается', () => {
    expect(isSupportedVersion(BACKUP_VERSION + 1)).toBe(false);
  });

  it('мусорная версия не читается', () => {
    expect(isSupportedVersion(0)).toBe(false);
    expect(isSupportedVersion(-1)).toBe(false);
    expect(isSupportedVersion(1.5)).toBe(false);
    expect(isSupportedVersion(Number.NaN)).toBe(false);
  });
});

describe('backupCounts', () => {
  it('пустая выгрузка — нули по всем таблицам', () => {
    const counts = backupCounts(EMPTY);

    expect(totalRecords(EMPTY)).toBe(0);
    expect(Object.values(counts).every((count) => count === 0)).toBe(true);
  });

  it('считает записи по таблицам', () => {
    const backup: Backup = {
      ...EMPTY,
      weights: [
        { date: '2026-07-27', kg: 124 },
        { date: '2026-07-28', kg: 123.5 },
      ],
      daily: [{ date: '2026-07-28', steps: 9000, waterGlasses: 8, sleepH: null }],
    };

    expect(backupCounts(backup).weights).toBe(2);
    expect(totalRecords(backup)).toBe(3);
  });

  // Если в схему добавят таблицу, а в счётчик — забудут, «без потерь»
  // превратится в «без части данных, о которой никто не узнает».
  it('счётчик покрывает все массивы схемы', () => {
    const arrayKeys = Object.entries(EMPTY)
      .filter(([, value]) => Array.isArray(value))
      .map(([key]) => key);

    expect(Object.keys(backupCounts(EMPTY)).sort()).toEqual(arrayKeys.sort());
  });
});
