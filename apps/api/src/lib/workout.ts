import type { Exercise, Prisma } from '@prisma/client';
import {
  type ExerciseInfo,
  type IsoDate,
  type ProgramInfo,
  type SetValues,
  type WorkoutDay,
  type WorkoutExercise,
  type WorkoutInfo,
  countDoneSets,
  dateColumnToIso,
  duplicateLastSet,
  isoToDateColumn,
  prefillSets,
  workoutVolume,
} from '@tracker/shared';

import { prisma } from '../db.js';

export function toExerciseInfo(exercise: Exercise): ExerciseInfo {
  return {
    id: exercise.id,
    name: exercise.name,
    muscleGroup: exercise.muscleGroup,
    equipment: exercise.equipment,
    isCardio: exercise.isCardio,
    restSec: exercise.restSec,
    isOwn: exercise.userId !== null,
  };
}

const programInclude = {
  items: { include: { exercise: true }, orderBy: { order: 'asc' } },
} satisfies Prisma.ProgramInclude;

export function toProgramInfo(
  program: Prisma.ProgramGetPayload<{ include: typeof programInclude }>,
): ProgramInfo {
  return {
    id: program.id,
    name: program.name,
    items: program.items.map((item) => ({
      id: item.id,
      exercise: toExerciseInfo(item.exercise),
      order: item.order,
      targetSets: item.targetSets,
      targetReps: item.targetReps,
    })),
  };
}

export async function listPrograms(userId: string): Promise<ProgramInfo[]> {
  const programs = await prisma.program.findMany({
    where: { userId },
    include: programInclude,
    orderBy: { name: 'asc' },
  });

  return programs.map(toProgramInfo);
}

/**
 * Значения прошлого раза для упражнения (FR-5.4).
 *
 * Берётся последняя тренировка, где это упражнение ВСТРЕЧАЛОСЬ, — не последняя
 * вообще: программы чередуются, и присед из позавчерашней A актуальнее, чем
 * его отсутствие во вчерашней B. Работает на индексе
 * workout_sets(exercise_id, created_at) из блока 1.
 */
export async function getLastSetsForExercise(
  userId: string,
  exerciseId: string,
  excludeWorkoutId?: string,
): Promise<SetValues[]> {
  const lastSet = await prisma.workoutSet.findFirst({
    where: {
      exerciseId,
      workout: { userId, ...(excludeWorkoutId ? { id: { not: excludeWorkoutId } } : {}) },
    },
    orderBy: { createdAt: 'desc' },
    select: { workoutId: true },
  });

  if (!lastSet) return [];

  const sets = await prisma.workoutSet.findMany({
    where: { workoutId: lastSet.workoutId, exerciseId },
    orderBy: { setIndex: 'asc' },
  });

  return sets.map((set) => ({ weightKg: set.weightKg, reps: set.reps }));
}

const workoutInclude = {
  program: { include: programInclude },
  sets: { include: { exercise: true }, orderBy: [{ exerciseId: 'asc' }, { setIndex: 'asc' }] },
} satisfies Prisma.WorkoutInclude;

type WorkoutRow = Prisma.WorkoutGetPayload<{ include: typeof workoutInclude }>;

function toWorkoutInfo(workout: WorkoutRow): WorkoutInfo {
  // Порядок упражнений задаётся программой; добавленные сверх неё идут следом
  // в порядке появления подходов.
  const order = new Map(workout.program?.items.map((item, index) => [item.exerciseId, index]) ?? []);

  const byExercise = new Map<string, WorkoutExercise>();

  for (const set of workout.sets) {
    const existing = byExercise.get(set.exerciseId);
    const target = workout.program?.items.find((item) => item.exerciseId === set.exerciseId);

    const entry: WorkoutExercise = existing ?? {
      exercise: toExerciseInfo(set.exercise),
      targetSets: target?.targetSets ?? null,
      targetReps: target?.targetReps ?? null,
      sets: [],
    };

    entry.sets.push({
      id: set.id,
      exerciseId: set.exerciseId,
      setIndex: set.setIndex,
      weightKg: set.weightKg,
      reps: set.reps,
      done: set.done,
    });

    byExercise.set(set.exerciseId, entry);
  }

  const exercises = [...byExercise.entries()]
    .sort(([a], [b]) => (order.get(a) ?? Number.MAX_SAFE_INTEGER) - (order.get(b) ?? Number.MAX_SAFE_INTEGER))
    .map(([, entry]) => entry);

  const allSets = workout.sets.map((set) => ({
    weightKg: set.weightKg,
    reps: set.reps,
    done: set.done,
  }));

  return {
    id: workout.id,
    date: dateColumnToIso(workout.date),
    programId: workout.programId,
    programName: workout.program?.name ?? null,
    note: workout.note,
    durationMin: workout.durationMin,
    exercises,
    volume: workoutVolume(allSets),
    doneSets: countDoneSets(allSets),
    totalSets: allSets.length,
  };
}

export async function getWorkoutDay(userId: string, date: IsoDate): Promise<WorkoutDay> {
  const [workout, programs, daily, profile] = await Promise.all([
    prisma.workout.findFirst({
      where: { userId, date: isoToDateColumn(date) },
      include: workoutInclude,
      orderBy: { createdAt: 'desc' },
    }),
    listPrograms(userId),
    prisma.daily.findUnique({ where: { userId_date: { userId, date: isoToDateColumn(date) } } }),
    prisma.profile.findUnique({ where: { userId } }),
  ]);

  return {
    date,
    workout: workout ? toWorkoutInfo(workout) : null,
    programs,
    steps: daily?.steps ?? null,
    stepsTarget: profile?.stepsTarget ?? 0,
  };
}

/**
 * Старт тренировки: подходы создаются сразу, предзаполненными значениями
 * прошлого раза (FR-5.4). Их наличие в БД — то, что превращает логирование
 * в двадцать тапов по готовым строкам вместо двадцати созданий записей.
 */
export async function startWorkout(
  userId: string,
  date: IsoDate,
  programId?: string | null,
): Promise<{ ok: true; id: string } | { ok: false; error: 'program_not_found' }> {
  const program = programId
    ? await prisma.program.findFirst({ where: { id: programId, userId }, include: programInclude })
    : null;

  if (programId && !program) return { ok: false, error: 'program_not_found' };

  const workout = await prisma.workout.create({
    data: { userId, date: isoToDateColumn(date), programId: program?.id ?? null },
  });

  for (const item of program?.items ?? []) {
    const lastTime = await getLastSetsForExercise(userId, item.exerciseId, workout.id);
    const prefilled = prefillSets({
      lastTime,
      targetSets: item.targetSets,
      targetReps: item.targetReps,
    });

    await prisma.workoutSet.createMany({
      data: prefilled.map((set) => ({
        workoutId: workout.id,
        exerciseId: item.exerciseId,
        setIndex: set.setIndex,
        weightKg: set.weightKg,
        reps: set.reps,
        done: false,
      })),
    });
  }

  return { ok: true, id: workout.id };
}

/** «+ подход»: дублирует последний подход этого упражнения (FR-5.4). */
export async function addSet(
  userId: string,
  workoutId: string,
  exerciseId: string,
  values?: Partial<SetValues> & { done?: boolean },
): Promise<{ ok: true } | { ok: false; error: 'not_found' }> {
  const workout = await prisma.workout.findFirst({ where: { id: workoutId, userId } });
  if (!workout) return { ok: false, error: 'not_found' };

  const existing = await prisma.workoutSet.findMany({
    where: { workoutId, exerciseId },
    orderBy: { setIndex: 'asc' },
  });

  // Первый подход упражнения в этой тренировке дублировать нечего — берём
  // прошлый раз, иначе добавленное по ходу упражнение приходило бы пустым
  // и требовало клавиатуры вопреки FR-5.4.
  const source =
    existing.length > 0
      ? existing.map((set) => ({ setIndex: set.setIndex, weightKg: set.weightKg, reps: set.reps }))
      : (await getLastSetsForExercise(userId, exerciseId, workoutId)).map((set, index) => ({
          setIndex: index + 1,
          ...set,
        }));

  const next = duplicateLastSet(source);
  // Номер считаем по этой тренировке: у истории своя нумерация.
  next.setIndex = existing.length + 1;

  await prisma.workoutSet.create({
    data: {
      workoutId,
      exerciseId,
      setIndex: next.setIndex,
      weightKg: values?.weightKg !== undefined ? values.weightKg : next.weightKg,
      reps: values?.reps !== undefined ? values.reps : next.reps,
      done: values?.done ?? false,
    },
  });

  return { ok: true };
}

export async function findWorkoutIdBySet(userId: string, setId: string): Promise<string | null> {
  const set = await prisma.workoutSet.findFirst({
    where: { id: setId, workout: { userId } },
    select: { workoutId: true },
  });

  return set?.workoutId ?? null;
}

export async function getWorkoutDate(userId: string, workoutId: string): Promise<IsoDate | null> {
  const workout = await prisma.workout.findFirst({
    where: { id: workoutId, userId },
    select: { date: true },
  });

  return workout ? dateColumnToIso(workout.date) : null;
}

export async function setSteps(userId: string, date: IsoDate, steps: number | null): Promise<void> {
  const key = { userId, date: isoToDateColumn(date) };

  await prisma.daily.upsert({
    where: { userId_date: key },
    create: { ...key, steps },
    update: { steps },
  });
}
