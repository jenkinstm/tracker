import {
  BACKUP_VERSION,
  type Backup,
  dateColumnToIso,
  isSupportedVersion,
  isoToDateColumn,
} from '@tracker/shared';

import { prisma } from '../db.js';

/**
 * Выгрузка и восстановление (FR-8.1, FR-8.3).
 *
 * Сидовые продукты и упражнения не выгружаются: их вернёт сидер, а их
 * идентификаторы детерминированные, так что ссылки уцелеют.
 */
export async function exportData(userId: string): Promise<Backup> {
  const [
    profile,
    foods,
    foodUnits,
    recipes,
    recipeItems,
    diaryEntries,
    mealTemplates,
    weights,
    measurements,
    photos,
    exercises,
    programs,
    programItems,
    workouts,
    workoutSets,
    activities,
    daily,
    reminders,
  ] = await Promise.all([
    prisma.profile.findUnique({ where: { userId } }),
    prisma.food.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
    prisma.foodUnit.findMany({ where: { food: { userId } }, orderBy: { id: 'asc' } }),
    prisma.recipe.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
    prisma.recipeItem.findMany({ where: { recipe: { userId } }, orderBy: { id: 'asc' } }),
    prisma.diaryEntry.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
    prisma.mealTemplate.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
    prisma.weight.findMany({ where: { userId }, orderBy: { date: 'asc' } }),
    prisma.measurement.findMany({ where: { userId }, orderBy: { date: 'asc' } }),
    prisma.photo.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
    prisma.exercise.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
    prisma.program.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
    prisma.programItem.findMany({ where: { program: { userId } }, orderBy: { id: 'asc' } }),
    prisma.workout.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
    prisma.workoutSet.findMany({ where: { workout: { userId } }, orderBy: { id: 'asc' } }),
    prisma.activity.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
    prisma.daily.findMany({ where: { userId }, orderBy: { date: 'asc' } }),
    prisma.reminder.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
  ]);

  return {
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    profile: profile
      ? {
          sex: profile.sex,
          birthYear: profile.birthYear,
          heightCm: profile.heightCm,
          activityLevel: profile.activityLevel,
          startWeight: profile.startWeight,
          goalWeight: profile.goalWeight,
          deficitMode: profile.deficitMode,
          deficitValue: profile.deficitValue,
          proteinPerKg: profile.proteinPerKg,
          fatPerKg: profile.fatPerKg,
          kcalTarget: profile.kcalTarget,
          proteinTarget: profile.proteinTarget,
          fatTarget: profile.fatTarget,
          carbTarget: profile.carbTarget,
          sweetsBudget: profile.sweetsBudget,
          windowStart: profile.windowStart,
          windowEnd: profile.windowEnd,
          stepsTarget: profile.stepsTarget,
          waterTarget: profile.waterTarget,
        }
      : null,
    foods: foods.map((f) => ({
      id: f.id,
      name: f.name,
      brand: f.brand,
      barcode: f.barcode,
      kcal100: f.kcal100,
      protein100: f.protein100,
      fat100: f.fat100,
      carb100: f.carb100,
      fiber100: f.fiber100,
      defaultPortionG: f.defaultPortionG,
      isSweet: f.isSweet,
      source: f.source,
      offId: f.offId,
    })),
    foodUnits: foodUnits.map((u) => ({ foodId: u.foodId, unitName: u.unitName, grams: u.grams })),
    recipes: recipes.map((r) => ({ id: r.id, name: r.name, totalYieldG: r.totalYieldG })),
    recipeItems: recipeItems.map((i) => ({
      recipeId: i.recipeId,
      foodId: i.foodId,
      grams: i.grams,
    })),
    diaryEntries: diaryEntries.map((e) => ({
      id: e.id,
      date: dateColumnToIso(e.date),
      time: e.time,
      foodId: e.foodId,
      recipeId: e.recipeId,
      name: e.name,
      grams: e.grams,
      kcal: e.kcal,
      protein: e.protein,
      fat: e.fat,
      carb: e.carb,
      isSweet: e.isSweet,
      mealType: e.mealType,
      isEstimate: e.isEstimate,
    })),
    mealTemplates: mealTemplates.map((t) => ({ id: t.id, name: t.name, itemsJson: t.itemsJson })),
    weights: weights.map((w) => ({ date: dateColumnToIso(w.date), kg: w.kg })),
    measurements: measurements.map((m) => ({
      date: dateColumnToIso(m.date),
      waist: m.waist,
      chest: m.chest,
      hip: m.hip,
      neck: m.neck,
    })),
    photos: photos.map((p) => ({
      id: p.id,
      date: dateColumnToIso(p.date),
      path: p.path,
      angle: p.angle,
    })),
    exercises: exercises.map((e) => ({
      id: e.id,
      name: e.name,
      muscleGroup: e.muscleGroup,
      equipment: e.equipment,
      isCardio: e.isCardio,
      restSec: e.restSec,
    })),
    programs: programs.map((p) => ({ id: p.id, name: p.name })),
    programItems: programItems.map((i) => ({
      programId: i.programId,
      exerciseId: i.exerciseId,
      order: i.order,
      targetSets: i.targetSets,
      targetReps: i.targetReps,
    })),
    workouts: workouts.map((w) => ({
      id: w.id,
      date: dateColumnToIso(w.date),
      programId: w.programId,
      note: w.note,
      durationMin: w.durationMin,
    })),
    workoutSets: workoutSets.map((s) => ({
      id: s.id,
      workoutId: s.workoutId,
      exerciseId: s.exerciseId,
      setIndex: s.setIndex,
      weightKg: s.weightKg,
      reps: s.reps,
      done: s.done,
    })),
    activities: activities.map((a) => ({
      id: a.id,
      date: dateColumnToIso(a.date),
      type: a.type,
      durationMin: a.durationMin,
      intensity: a.intensity,
      kcalEst: a.kcalEst,
    })),
    daily: daily.map((d) => ({
      date: dateColumnToIso(d.date),
      steps: d.steps,
      waterGlasses: d.waterGlasses,
      sleepH: d.sleepH,
    })),
    reminders: reminders.map((r) => ({
      id: r.id,
      time: r.time,
      kind: r.kind,
      text: r.text,
      enabled: r.enabled,
    })),
  };
}

export type ImportFailure = 'unsupported_version' | 'not_empty';

/** Есть ли у пользователя данные, которые импорт затрёт. */
export async function hasUserData(userId: string): Promise<boolean> {
  const [diary, weights, workouts, foods] = await Promise.all([
    prisma.diaryEntry.count({ where: { userId } }),
    prisma.weight.count({ where: { userId } }),
    prisma.workout.count({ where: { userId } }),
    prisma.food.count({ where: { userId } }),
  ]);

  return diary + weights + workouts + foods > 0;
}

/**
 * Восстановление в пустую инсталляцию (критерий приёмки №4).
 *
 * По умолчанию отказывается работать поверх непустой базы: слить две истории
 * в одну нельзя, а затереть чужую по ошибке — можно. `replace` включается
 * осознанно и сносит данные пользователя перед вставкой.
 */
export async function importData(
  userId: string,
  backup: Backup,
  options: { replace?: boolean } = {},
): Promise<{ ok: true } | { ok: false; error: ImportFailure }> {
  if (!isSupportedVersion(backup.version)) return { ok: false, error: 'unsupported_version' };

  if (await hasUserData(userId)) {
    if (!options.replace) return { ok: false, error: 'not_empty' };
    await wipeUserData(userId);
  }

  // Порядок вставки соблюдает внешние ключи: справочники, потом ссылки на них.
  await prisma.$transaction(async (tx) => {
    if (backup.profile) {
      await tx.profile.update({
        where: { userId },
        data: {
          ...backup.profile,
          sex: backup.profile.sex as 'MALE' | 'FEMALE' | null,
          activityLevel: backup.profile.activityLevel as 'SEDENTARY',
          deficitMode: backup.profile.deficitMode as 'PERCENT',
        },
      });
    }

    await tx.food.createMany({
      data: backup.foods.map((f) => ({ ...f, userId, source: f.source as 'OWN' })),
    });
    await tx.foodUnit.createMany({ data: backup.foodUnits });

    await tx.exercise.createMany({
      data: backup.exercises.map((e) => ({
        ...e,
        userId,
        muscleGroup: e.muscleGroup as 'LEGS',
        equipment: e.equipment as 'BARBELL',
      })),
    });

    await tx.recipe.createMany({ data: backup.recipes.map((r) => ({ ...r, userId })) });
    await tx.recipeItem.createMany({ data: backup.recipeItems });

    await tx.program.createMany({ data: backup.programs.map((p) => ({ ...p, userId })) });
    await tx.programItem.createMany({ data: backup.programItems });

    await tx.diaryEntry.createMany({
      data: backup.diaryEntries.map((e) => ({
        ...e,
        userId,
        date: isoToDateColumn(e.date),
        mealType: e.mealType as 'BREAKFAST' | null,
      })),
    });

    await tx.mealTemplate.createMany({
      data: backup.mealTemplates.map((t) => ({
        id: t.id,
        userId,
        name: t.name,
        itemsJson: t.itemsJson as object,
      })),
    });

    await tx.weight.createMany({
      data: backup.weights.map((w) => ({ userId, date: isoToDateColumn(w.date), kg: w.kg })),
    });
    await tx.measurement.createMany({
      data: backup.measurements.map((m) => ({ ...m, userId, date: isoToDateColumn(m.date) })),
    });
    await tx.photo.createMany({
      data: backup.photos.map((p) => ({
        ...p,
        userId,
        date: isoToDateColumn(p.date),
        angle: p.angle as 'FRONT' | null,
      })),
    });

    await tx.workout.createMany({
      data: backup.workouts.map((w) => ({ ...w, userId, date: isoToDateColumn(w.date) })),
    });
    await tx.workoutSet.createMany({ data: backup.workoutSets });

    await tx.activity.createMany({
      data: backup.activities.map((a) => ({ ...a, userId, date: isoToDateColumn(a.date) })),
    });
    await tx.daily.createMany({
      data: backup.daily.map((d) => ({ ...d, userId, date: isoToDateColumn(d.date) })),
    });
    await tx.reminder.createMany({
      data: backup.reminders.map((r) => ({ ...r, userId, kind: r.kind as 'WEIGH_IN' })),
    });
  });

  return { ok: true };
}

/** Данные пользователя, но не сид: справочник восстановит сидер. */
async function wipeUserData(userId: string): Promise<void> {
  await prisma.$transaction([
    prisma.workoutSet.deleteMany({ where: { workout: { userId } } }),
    prisma.workout.deleteMany({ where: { userId } }),
    prisma.programItem.deleteMany({ where: { program: { userId } } }),
    prisma.program.deleteMany({ where: { userId } }),
    prisma.exercise.deleteMany({ where: { userId } }),
    prisma.diaryEntry.deleteMany({ where: { userId } }),
    prisma.mealTemplate.deleteMany({ where: { userId } }),
    prisma.recipeItem.deleteMany({ where: { recipe: { userId } } }),
    prisma.recipe.deleteMany({ where: { userId } }),
    prisma.foodUnit.deleteMany({ where: { food: { userId } } }),
    prisma.food.deleteMany({ where: { userId } }),
    prisma.weight.deleteMany({ where: { userId } }),
    prisma.measurement.deleteMany({ where: { userId } }),
    prisma.photo.deleteMany({ where: { userId } }),
    prisma.activity.deleteMany({ where: { userId } }),
    prisma.daily.deleteMany({ where: { userId } }),
    prisma.reminder.deleteMany({ where: { userId } }),
  ]);
}
