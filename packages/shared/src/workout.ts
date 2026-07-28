import { z } from 'zod';

import { isIsoDate } from './date.js';
import { roundTo } from './round.js';

/**
 * Тренировки: предзаполнение подходов и быстрый ввод (FR-5.3, FR-5.4).
 *
 * Поподходное логирование трудоёмко по своей природе: пять упражнений
 * по четыре подхода — это двадцать записей. Всё в этом файле служит одному:
 * чтобы двадцать записей делались двадцатью тапами без клавиатуры,
 * пока веса не изменились (критерий приёмки №3).
 */

export type MuscleGroup =
  | 'LEGS'
  | 'GLUTES'
  | 'BACK'
  | 'CHEST'
  | 'SHOULDERS'
  | 'ARMS'
  | 'CORE'
  | 'FULL_BODY'
  | 'CARDIO';

export type Equipment =
  | 'BARBELL'
  | 'DUMBBELL'
  | 'BAND'
  | 'BODYWEIGHT'
  | 'SANDBAG'
  | 'FITBALL'
  | 'HYPEREXTENSION'
  | 'CARDIO'
  | 'OTHER';

export type SetValues = {
  /** null у упражнений с весом тела: планка не «нулевой вес», а без веса. */
  weightKg: number | null;
  reps: number | null;
};

export type PrefilledSet = SetValues & {
  setIndex: number;
  /** Откуда взялись числа — интерфейс показывает это подписью. */
  source: 'LAST_TIME' | 'PROGRAM' | 'EMPTY';
};

/** Сколько подходов предлагать, если не сказано ни программой, ни историей. */
export const DEFAULT_SET_COUNT = 3;

/**
 * Подходы для упражнения при старте тренировки (FR-5.4).
 *
 * Приоритет источников: прошлый раз важнее плана программы — план говорит,
 * сколько подходов делать, а прошлый раз говорит, с каким весом. Если
 * подходов в прошлый раз было меньше целевого, недостающие повторяют
 * последний: логичнее продолжить с рабочего веса, чем оставить пустую строку.
 */
export function prefillSets(input: {
  lastTime?: readonly SetValues[];
  targetSets?: number | null;
  targetReps?: number | null;
}): PrefilledSet[] {
  const lastTime = input.lastTime ?? [];
  const targetSets =
    normalizeCount(input.targetSets) ?? (lastTime.length > 0 ? lastTime.length : DEFAULT_SET_COUNT);

  return Array.from({ length: targetSets }, (_, index) => {
    // Прошлых подходов может не хватить — тянем последний из них.
    const previous = lastTime[index] ?? lastTime[lastTime.length - 1];

    if (previous) {
      return {
        setIndex: index + 1,
        weightKg: previous.weightKg,
        // Повторы прошлого раза важнее плана: план — намерение, история — факт.
        reps: previous.reps ?? normalizeCount(input.targetReps) ?? null,
        source: 'LAST_TIME' as const,
      };
    }

    const reps = normalizeCount(input.targetReps);

    return {
      setIndex: index + 1,
      weightKg: null,
      reps,
      source: reps === null ? ('EMPTY' as const) : ('PROGRAM' as const),
    };
  });
}

function normalizeCount(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  return rounded > 0 ? rounded : null;
}

/** Следующий подход по кнопке «+ подход»: дубль последнего (FR-5.4). */
export function duplicateLastSet(sets: readonly (SetValues & { setIndex: number })[]): PrefilledSet {
  const last = [...sets].sort((a, b) => a.setIndex - b.setIndex)[sets.length - 1];

  return {
    setIndex: (last?.setIndex ?? 0) + 1,
    weightKg: last?.weightKg ?? null,
    reps: last?.reps ?? null,
    source: last ? 'LAST_TIME' : 'EMPTY',
  };
}

/**
 * Тоннаж: сумма «вес × повторы» по ВЫПОЛНЕННЫМ подходам. Незакрытые подходы —
 * это план, а не работа, и в объём они не идут.
 */
export function workoutVolume(
  sets: readonly { weightKg: number | null; reps: number | null; done: boolean }[],
): number {
  const total = sets.reduce((sum, set) => {
    if (!set.done || set.weightKg === null || set.reps === null) return sum;
    return sum + set.weightKg * set.reps;
  }, 0);

  return roundTo(total, 1);
}

export function countDoneSets(sets: readonly { done: boolean }[]): number {
  return sets.filter((set) => set.done).length;
}

/**
 * Шаг стрелок ± (FR-5.4). У штанги блины кладутся парами, поэтому меньше
 * 2.5 кг набрать нельзя; гантели и резинки ходят мельче.
 */
export function weightStep(equipment: Equipment): number {
  switch (equipment) {
    case 'BARBELL':
      return 2.5;
    case 'DUMBBELL':
    case 'SANDBAG':
      return 1;
    default:
      return 0.5;
  }
}

/** Вес не уходит ниже нуля: отрицательного веса на штанге не бывает. */
export function stepWeight(current: number | null, direction: 1 | -1, step: number): number {
  const next = (current ?? 0) + direction * step;
  return next < 0 ? 0 : roundTo(next, 2);
}

export function stepReps(current: number | null, direction: 1 | -1): number {
  const next = (current ?? 0) + direction;
  return next < 0 ? 0 : next;
}

// ─────────────────────────────────────────── контракт API

const muscleGroup = z.enum([
  'LEGS',
  'GLUTES',
  'BACK',
  'CHEST',
  'SHOULDERS',
  'ARMS',
  'CORE',
  'FULL_BODY',
  'CARDIO',
]);

const equipment = z.enum([
  'BARBELL',
  'DUMBBELL',
  'BAND',
  'BODYWEIGHT',
  'SANDBAG',
  'FITBALL',
  'HYPEREXTENSION',
  'CARDIO',
  'OTHER',
]);

export const exerciseCreateSchema = z.object({
  name: z.string().trim().min(2).max(200),
  muscleGroup,
  equipment,
  isCardio: z.boolean().default(false),
  restSec: z.int().min(0).max(600).default(90),
});

export const exerciseUpdateSchema = exerciseCreateSchema.partial();

export const programItemSchema = z.object({
  exerciseId: z.string().min(1),
  targetSets: z.int().min(1).max(20).nullable(),
  targetReps: z.int().min(1).max(100).nullable(),
});

export const programCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  items: z.array(programItemSchema).max(30).default([]),
});

export const programUpdateSchema = programCreateSchema.partial();

export const workoutCreateSchema = z.object({
  date: z.string().refine(isIsoDate, 'дата в формате ГГГГ-ММ-ДД'),
  programId: z.string().min(1).nullish(),
});

export const workoutUpdateSchema = z
  .object({
    note: z.string().max(2000).nullable(),
    durationMin: z.int().min(0).max(1000).nullable(),
  })
  .partial();

const setValues = {
  weightKg: z.number().min(0).max(1000).nullable(),
  reps: z.int().min(0).max(1000).nullable(),
  done: z.boolean(),
};

export const setUpdateSchema = z.object(setValues).partial();

export const setCreateSchema = z.object({
  exerciseId: z.string().min(1),
  ...setValues,
}).partial({ weightKg: true, reps: true, done: true });

export type ExerciseCreate = z.infer<typeof exerciseCreateSchema>;
export type ExerciseUpdate = z.infer<typeof exerciseUpdateSchema>;
export type ProgramCreate = z.infer<typeof programCreateSchema>;
export type ProgramUpdate = z.infer<typeof programUpdateSchema>;
export type WorkoutCreate = z.infer<typeof workoutCreateSchema>;
export type WorkoutUpdate = z.infer<typeof workoutUpdateSchema>;
export type SetCreate = z.infer<typeof setCreateSchema>;
export type SetUpdate = z.infer<typeof setUpdateSchema>;

export type ExerciseInfo = {
  id: string;
  name: string;
  muscleGroup: MuscleGroup;
  equipment: Equipment;
  isCardio: boolean;
  restSec: number;
  /** Своё упражнение можно править и удалять, сидовое — нет. */
  isOwn: boolean;
};

export type ProgramItemInfo = {
  id: string;
  exercise: ExerciseInfo;
  order: number;
  targetSets: number | null;
  targetReps: number | null;
};

export type ProgramInfo = {
  id: string;
  name: string;
  items: ProgramItemInfo[];
};

export type WorkoutSetInfo = {
  id: string;
  exerciseId: string;
  setIndex: number;
  weightKg: number | null;
  reps: number | null;
  done: boolean;
};

export type WorkoutExercise = {
  exercise: ExerciseInfo;
  targetSets: number | null;
  targetReps: number | null;
  sets: WorkoutSetInfo[];
};

export type WorkoutInfo = {
  id: string;
  date: string;
  programId: string | null;
  programName: string | null;
  note: string | null;
  durationMin: number | null;
  exercises: WorkoutExercise[];
  volume: number;
  doneSets: number;
  totalSets: number;
};

export type WorkoutDay = {
  date: string;
  workout: WorkoutInfo | null;
  /** Программы для старта, если тренировки за день ещё нет. */
  programs: ProgramInfo[];
  steps: number | null;
  stepsTarget: number;
};

export const stepsUpdateSchema = z.object({
  steps: z.int().min(0).max(200000).nullable(),
});

export type StepsUpdate = z.infer<typeof stepsUpdateSchema>;
