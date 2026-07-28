import { z } from 'zod';

/**
 * Экспорт и восстановление данных (FR-8.1, FR-8.3).
 *
 * Формат обязан пережить смену версии приложения: это единственная страховка
 * от потери истории, и открывать его придётся через год. Поэтому — плоский
 * JSON без вложенности по связям, с явной версией схемы.
 *
 * Сидовые продукты и упражнения в выгрузку НЕ идут: их восстанавливает сидер,
 * а идентификаторы у них детерминированные (`seed:<slug>`), так что ссылки
 * из дневника и тренировок переживают восстановление. Иначе каждая выгрузка
 * таскала бы 313 строк справочника.
 */

export const BACKUP_VERSION = 1;

const isoDate = z.string();
const nullableNumber = z.number().nullable();

const profileSchema = z.object({
  sex: z.string().nullable(),
  birthYear: z.number().int().nullable(),
  heightCm: z.number().int().nullable(),
  activityLevel: z.string(),
  startWeight: nullableNumber,
  goalWeight: nullableNumber,
  deficitMode: z.string(),
  deficitValue: z.number(),
  proteinPerKg: nullableNumber,
  fatPerKg: nullableNumber,
  kcalTarget: z.number().int().nullable(),
  proteinTarget: z.number().int().nullable(),
  fatTarget: z.number().int().nullable(),
  carbTarget: z.number().int().nullable(),
  sweetsBudget: z.number().int().nullable(),
  windowStart: z.string(),
  windowEnd: z.string(),
  stepsTarget: z.number().int(),
  waterTarget: z.number().int(),
});

const foodSchema = z.object({
  id: z.string(),
  name: z.string(),
  brand: z.string().nullable(),
  barcode: z.string().nullable(),
  kcal100: z.number(),
  protein100: z.number(),
  fat100: z.number(),
  carb100: z.number(),
  fiber100: nullableNumber,
  defaultPortionG: nullableNumber,
  isSweet: z.boolean(),
  source: z.string(),
  offId: z.string().nullable(),
});

const foodUnitSchema = z.object({
  foodId: z.string(),
  unitName: z.string(),
  grams: z.number(),
});

const recipeSchema = z.object({
  id: z.string(),
  name: z.string(),
  totalYieldG: z.number(),
});

const recipeItemSchema = z.object({
  recipeId: z.string(),
  foodId: z.string(),
  grams: z.number(),
});

const diaryEntrySchema = z.object({
  id: z.string(),
  date: isoDate,
  time: z.string(),
  foodId: z.string().nullable(),
  recipeId: z.string().nullable(),
  name: z.string(),
  grams: nullableNumber,
  kcal: z.number(),
  protein: z.number(),
  fat: z.number(),
  carb: z.number(),
  isSweet: z.boolean(),
  mealType: z.string().nullable(),
  isEstimate: z.boolean(),
});

const mealTemplateSchema = z.object({
  id: z.string(),
  name: z.string(),
  itemsJson: z.unknown(),
});

const weightSchema = z.object({ date: isoDate, kg: z.number() });

const measurementSchema = z.object({
  date: isoDate,
  waist: nullableNumber,
  chest: nullableNumber,
  hip: nullableNumber,
  neck: nullableNumber,
});

/** Файлы фотографий лежат на диске и в JSON не попадают — только их пути. */
const photoSchema = z.object({
  id: z.string(),
  date: isoDate,
  path: z.string(),
  angle: z.string().nullable(),
});

const exerciseSchema = z.object({
  id: z.string(),
  name: z.string(),
  muscleGroup: z.string(),
  equipment: z.string(),
  isCardio: z.boolean(),
  restSec: z.number().int(),
});

const programSchema = z.object({ id: z.string(), name: z.string() });

const programItemSchema = z.object({
  programId: z.string(),
  exerciseId: z.string(),
  order: z.number().int(),
  targetSets: z.number().int().nullable(),
  targetReps: z.number().int().nullable(),
});

const workoutSchema = z.object({
  id: z.string(),
  date: isoDate,
  programId: z.string().nullable(),
  note: z.string().nullable(),
  durationMin: z.number().int().nullable(),
});

const workoutSetSchema = z.object({
  id: z.string(),
  workoutId: z.string(),
  exerciseId: z.string(),
  setIndex: z.number().int(),
  weightKg: nullableNumber,
  reps: z.number().int().nullable(),
  done: z.boolean(),
});

const activitySchema = z.object({
  id: z.string(),
  date: isoDate,
  type: z.string(),
  durationMin: z.number().int(),
  intensity: z.number().int().nullable(),
  kcalEst: z.number().int().nullable(),
});

const dailySchema = z.object({
  date: isoDate,
  steps: z.number().int().nullable(),
  waterGlasses: z.number().int(),
  sleepH: nullableNumber,
});

const reminderSchema = z.object({
  id: z.string(),
  time: z.string(),
  kind: z.string(),
  text: z.string().nullable(),
  enabled: z.boolean(),
});

export const backupSchema = z.object({
  version: z.number().int(),
  exportedAt: z.string(),
  profile: profileSchema.nullable(),
  foods: z.array(foodSchema),
  foodUnits: z.array(foodUnitSchema),
  recipes: z.array(recipeSchema),
  recipeItems: z.array(recipeItemSchema),
  diaryEntries: z.array(diaryEntrySchema),
  mealTemplates: z.array(mealTemplateSchema),
  weights: z.array(weightSchema),
  measurements: z.array(measurementSchema),
  photos: z.array(photoSchema),
  exercises: z.array(exerciseSchema),
  programs: z.array(programSchema),
  programItems: z.array(programItemSchema),
  workouts: z.array(workoutSchema),
  workoutSets: z.array(workoutSetSchema),
  activities: z.array(activitySchema),
  daily: z.array(dailySchema),
  reminders: z.array(reminderSchema),
});

export type Backup = z.infer<typeof backupSchema>;

/** Сколько записей в выгрузке — показывается перед восстановлением. */
export function backupCounts(backup: Backup): Record<string, number> {
  return {
    foods: backup.foods.length,
    foodUnits: backup.foodUnits.length,
    recipes: backup.recipes.length,
    recipeItems: backup.recipeItems.length,
    diaryEntries: backup.diaryEntries.length,
    mealTemplates: backup.mealTemplates.length,
    weights: backup.weights.length,
    measurements: backup.measurements.length,
    photos: backup.photos.length,
    exercises: backup.exercises.length,
    programs: backup.programs.length,
    programItems: backup.programItems.length,
    workouts: backup.workouts.length,
    workoutSets: backup.workoutSets.length,
    activities: backup.activities.length,
    daily: backup.daily.length,
    reminders: backup.reminders.length,
  };
}

export function totalRecords(backup: Backup): number {
  return Object.values(backupCounts(backup)).reduce((sum, count) => sum + count, 0);
}

/**
 * Совместимость версии. Читать выгрузку из будущего мы не умеем и не должны
 * делать вид, что умеем: молча пропущенное поле — это потерянная история.
 */
export function isSupportedVersion(version: number): boolean {
  return Number.isInteger(version) && version >= 1 && version <= BACKUP_VERSION;
}
