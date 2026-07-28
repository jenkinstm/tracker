import { z } from 'zod';

/**
 * Сид-записи получают детерминированный id `seed:<slug>` вместо cuid().
 * Так повторный запуск сидера обновляет строку, а не создаёт вторую копию,
 * и при этом схема БД не обрастает колонкой под внешний ключ.
 */
export const SEED_PREFIX = 'seed:';

export function seedId(slug: string): string {
  return SEED_PREFIX + slug;
}

const slug = z
  .string()
  .min(2)
  .regex(/^[a-z0-9-]+$/, 'slug: только строчная латиница, цифры и дефис');

const per100 = z.number().min(0).max(100);

export const seedFoodUnitSchema = z.object({
  name: z.string().min(1),
  grams: z.number().positive().max(1000),
});

export const seedFoodSchema = z.object({
  id: slug,
  name: z.string().min(2),
  /** Всё на 100 г готового продукта: варёная гречка, а не сухая. */
  kcal: z.number().min(0).max(900),
  protein: per100,
  fat: per100,
  carb: per100,
  /** Часть `carb`, а не добавка к ним: клетчатка уже посчитана в углеводах. */
  fiber: per100.optional(),
  /**
   * В БД не попадает: колонки под алкоголь в схеме нет. Нужен, чтобы проверка
   * «ккал сходятся с макросами» не спотыкалась о напитки, где почти вся
   * энергия — этанол (7 ккал/г).
   */
  alcohol: per100.optional(),
  /** Типичная порция в граммах — для добавления в один тап (FR-2.2). */
  portion: z.number().positive().max(1000),
  isSweet: z.boolean().optional(),
  units: z.array(seedFoodUnitSchema).optional(),
});

export type SeedFood = z.infer<typeof seedFoodSchema>;

export const MUSCLE_GROUPS = [
  'LEGS',
  'GLUTES',
  'BACK',
  'CHEST',
  'SHOULDERS',
  'ARMS',
  'CORE',
  'FULL_BODY',
  'CARDIO',
] as const;

export const EQUIPMENT = [
  'BARBELL',
  'DUMBBELL',
  'BAND',
  'BODYWEIGHT',
  'SANDBAG',
  'FITBALL',
  'HYPEREXTENSION',
  'CARDIO',
  'OTHER',
] as const;

export const seedExerciseSchema = z.object({
  id: slug,
  name: z.string().min(2),
  muscleGroup: z.enum(MUSCLE_GROUPS),
  equipment: z.enum(EQUIPMENT),
  isCardio: z.boolean().optional(),
  restSec: z.number().int().positive().max(600),
});

export type SeedExercise = z.infer<typeof seedExerciseSchema>;

export const seedProgramSchema = z.object({
  id: slug,
  name: z.string().min(1),
  items: z
    .array(
      z.object({
        exerciseId: slug,
        targetSets: z.number().int().positive().max(20),
        /** null для планки и переносок: там считаются секунды, а не повторы. */
        targetReps: z.number().int().positive().max(100).nullable(),
      }),
    )
    .min(1),
});

export type SeedProgram = z.infer<typeof seedProgramSchema>;
