import {
  DEFAULT_TIMEZONE,
  type DiaryCreate,
  type DiaryDay,
  type DiaryEntryInfo,
  type DiaryUpdate,
  type IsoDate,
  dateColumnToIso,
  isoToDateColumn,
  mealTypeByTime,
  remaining,
  scaleNutrients,
  sumNutrients,
  sumSweetKcal,
  toTimeOfDay,
} from '@tracker/shared';

import { prisma } from '../db.js';
import { getAccessibleFood } from './foodSearch.js';
import { getProfileResponse } from './profile.js';

/** День дневника: записи, итоги, остаток от нормы и вода (FR-2.13). */
export async function getDiaryDay(userId: string, date: IsoDate): Promise<DiaryDay> {
  const [rows, daily, profile] = await Promise.all([
    prisma.diaryEntry.findMany({
      where: { userId, date: isoToDateColumn(date) },
      orderBy: [{ time: 'asc' }, { createdAt: 'asc' }],
    }),
    prisma.daily.findUnique({ where: { userId_date: { userId, date: isoToDateColumn(date) } } }),
    getProfileResponse(userId),
  ]);

  const entries: DiaryEntryInfo[] = rows.map((row) => ({
    id: row.id,
    date: dateColumnToIso(row.date),
    time: row.time,
    foodId: row.foodId,
    name: row.name,
    grams: row.grams,
    kcal: row.kcal,
    protein: row.protein,
    fat: row.fat,
    carb: row.carb,
    isSweet: row.isSweet,
    mealType: row.mealType,
    isEstimate: row.isEstimate,
  }));

  const totals = sumNutrients(entries);
  const sweetKcal = sumSweetKcal(entries);
  const target = profile.effective;

  return {
    date,
    entries,
    totals,
    sweetKcal,
    remaining: {
      kcal: remaining(target.kcal, totals.kcal),
      protein: remaining(target.protein, totals.protein),
      fat: remaining(target.fat, totals.fat),
      carb: remaining(target.carb, totals.carb),
      sweets: remaining(target.sweets, sweetKcal),
    },
    water: {
      glasses: daily?.waterGlasses ?? 0,
      target: profile.profile.waterTarget,
    },
  };
}

/** Почему операция не прошла — роут переводит это в код ответа. */
export type DiaryFailure = 'food_not_found' | 'invalid_grams' | 'not_found' | 'food_gone';

type Result<T> = { ok: true; value: T } | { ok: false; error: DiaryFailure };

/** Добавление записи (FR-2.2, FR-2.3). */
export async function createDiaryEntry(
  userId: string,
  input: DiaryCreate,
): Promise<Result<IsoDate>> {
  const food = await getAccessibleFood(userId, input.foodId);
  if (!food) return { ok: false, error: 'food_not_found' };

  const nutrients = scaleNutrients(food, input.grams);
  if (!nutrients) return { ok: false, error: 'invalid_grams' };

  const time = input.time ?? toTimeOfDay(new Date(), DEFAULT_TIMEZONE);

  await prisma.diaryEntry.create({
    data: {
      userId,
      date: isoToDateColumn(input.date),
      time,
      foodId: food.id,
      // Снимок на момент записи: правка продукта не меняет историю (правило 4).
      name: food.name,
      grams: input.grams,
      ...nutrients,
      isSweet: food.isSweet,
      mealType: input.mealType ?? mealTypeByTime(time),
    },
  });

  return { ok: true, value: input.date };
}

/** Правка количества, времени, типа приёма и даты (FR-2.4). */
export async function updateDiaryEntry(
  userId: string,
  id: string,
  input: DiaryUpdate,
): Promise<Result<IsoDate>> {
  const entry = await prisma.diaryEntry.findFirst({ where: { id, userId } });
  if (!entry) return { ok: false, error: 'not_found' };

  const data: Record<string, unknown> = {};

  if (input.time !== undefined) data.time = input.time;
  if (input.mealType !== undefined) data.mealType = input.mealType;
  if (input.date !== undefined) data.date = isoToDateColumn(input.date);

  if (input.grams !== undefined) {
    // Пересчитываем от продукта, а не масштабируем снимок: делить на старый
    // вес и умножать на новый — копить ошибку округления на каждой правке.
    const food = entry.foodId ? await getAccessibleFood(userId, entry.foodId) : null;
    if (!food) return { ok: false, error: 'food_gone' };

    const nutrients = scaleNutrients(food, input.grams);
    if (!nutrients) return { ok: false, error: 'invalid_grams' };

    Object.assign(data, { grams: input.grams, ...nutrients });
  }

  const updated = await prisma.diaryEntry.update({ where: { id: entry.id }, data });

  return { ok: true, value: dateColumnToIso(updated.date) };
}

export async function deleteDiaryEntry(userId: string, id: string): Promise<Result<IsoDate>> {
  const entry = await prisma.diaryEntry.findFirst({ where: { id, userId } });
  if (!entry) return { ok: false, error: 'not_found' };

  await prisma.diaryEntry.delete({ where: { id: entry.id } });

  return { ok: true, value: dateColumnToIso(entry.date) };
}

/** Вода: счётчик стаканов (FR-2.13). */
export async function setWaterGlasses(
  userId: string,
  date: IsoDate,
  glasses: number,
): Promise<void> {
  const key = { userId, date: isoToDateColumn(date) };

  await prisma.daily.upsert({
    where: { userId_date: key },
    create: { ...key, waterGlasses: glasses },
    update: { waterGlasses: glasses },
  });
}
