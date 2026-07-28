import { z } from 'zod';

import { isIsoDate } from './date.js';
import type { MealType } from './mealType.js';
import type { Nutrients } from './portion.js';

/** Дневник питания (FR-2.1 – FR-2.6) и вода (FR-2.13). */

const isoDate = z.string().refine(isIsoDate, 'дата в формате ГГГГ-ММ-ДД');
const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'время в формате ЧЧ:ММ');
const mealType = z.enum(['BREAKFAST', 'LUNCH', 'DINNER', 'SNACK']);

const grams = z.number().min(0).max(10000);
const per100 = z.number().min(0).max(1000);

// ─────────────────────────────────────────── продукты

export const foodSearchSchema = z.object({
  q: z.string().min(1).max(100),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const foodCreateSchema = z.object({
  name: z.string().trim().min(2).max(200),
  brand: z.string().trim().max(200).nullish(),
  kcal100: per100,
  protein100: per100,
  fat100: per100,
  carb100: per100,
  fiber100: per100.nullish(),
  defaultPortionG: z.number().positive().max(10000).nullish(),
  isSweet: z.boolean().default(false),
});

export const foodUpdateSchema = foodCreateSchema.partial();

export type FoodCreate = z.infer<typeof foodCreateSchema>;
export type FoodUpdate = z.infer<typeof foodUpdateSchema>;

export type FoodUnitInfo = { unitName: string; grams: number };

export type FoodInfo = {
  id: string;
  name: string;
  brand: string | null;
  kcal100: number;
  protein100: number;
  fat100: number;
  carb100: number;
  fiber100: number | null;
  defaultPortionG: number | null;
  isSweet: boolean;
  source: 'SEED' | 'OWN' | 'OFF';
  /** Свой продукт можно править и удалять, сидовый — нет. */
  isOwn: boolean;
  units: FoodUnitInfo[];
};

// ─────────────────────────────────────────── записи дневника

export const diaryCreateSchema = z.object({
  date: isoDate,
  /** Не передано — проставим текущее время в поясе пользователя. */
  time: timeOfDay.optional(),
  foodId: z.string().min(1),
  grams,
  /** Не передан — определим по времени (FR-2.3). */
  mealType: mealType.optional(),
});

export const diaryUpdateSchema = z
  .object({
    time: timeOfDay,
    grams,
    mealType: mealType.nullable(),
    date: isoDate,
  })
  .partial();

export type DiaryCreate = z.infer<typeof diaryCreateSchema>;
export type DiaryUpdate = z.infer<typeof diaryUpdateSchema>;

export type DiaryEntryInfo = Nutrients & {
  id: string;
  date: string;
  time: string;
  foodId: string | null;
  name: string;
  grams: number | null;
  isSweet: boolean;
  mealType: MealType | null;
  isEstimate: boolean;
};

export type DiaryDay = {
  date: string;
  entries: DiaryEntryInfo[];
  totals: Nutrients;
  sweetKcal: number;
  /** Остаток от нормы; null там, где норма не задана. */
  remaining: {
    kcal: number | null;
    protein: number | null;
    fat: number | null;
    carb: number | null;
    sweets: number | null;
  };
  water: { glasses: number; target: number };
};

/** «Недавние» и «частые» (FR-2.6): добавление в один тап прошлым весом. */
export type RecentFood = FoodInfo & {
  lastGrams: number;
  lastUsedAt: string;
  useCount: number;
};

export type RecentResponse = {
  recent: RecentFood[];
  frequent: RecentFood[];
};

// ─────────────────────────────────────────── вода

export const waterUpdateSchema = z.object({
  glasses: z.number().int().min(0).max(50),
});

export type WaterUpdate = z.infer<typeof waterUpdateSchema>;
