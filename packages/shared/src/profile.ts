import { z } from 'zod';

import type { EffectiveTargets, MissingField, Targets } from './nutrition.js';

/**
 * Профиль и цели (FR-1.1 – FR-1.5). Типы для фронта выводятся из этих схем,
 * руками не дублируются.
 */

const sex = z.enum(['MALE', 'FEMALE']);
const activityLevel = z.enum(['SEDENTARY', 'LIGHT', 'MODERATE', 'HIGH', 'ATHLETE']);
const deficitMode = z.enum(['PERCENT', 'KCAL']);

/** «ЧЧ:ММ» — в БД хранится строкой, поэтому проверяем формат здесь. */
const timeOfDay = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'время в формате ЧЧ:ММ');

/** Ручное переопределение (FR-1.3): null означает «считай по формуле». */
const override = (schema: z.ZodType<number>) => schema.nullable();

export const profileUpdateSchema = z
  .object({
    sex: sex.nullable(),
    birthYear: z.int().min(1900).max(2100).nullable(),
    heightCm: z.int().min(50).max(272).nullable(),
    activityLevel,

    startWeight: z.number().min(20).max(500).nullable(),
    goalWeight: z.number().min(20).max(500).nullable(),

    deficitMode,
    deficitValue: z.number().min(0).max(5000),

    proteinPerKg: z.number().min(0).max(5).nullable(),
    fatPerKg: z.number().min(0).max(5).nullable(),

    kcalTarget: override(z.int().min(500).max(10000)),
    proteinTarget: override(z.int().min(0).max(500)),
    fatTarget: override(z.int().min(0).max(500)),
    carbTarget: override(z.int().min(0).max(1000)),
    sweetsBudget: override(z.int().min(0).max(5000)),

    windowStart: timeOfDay,
    windowEnd: timeOfDay,
    stepsTarget: z.int().min(0).max(100000),
    waterTarget: z.int().min(0).max(50),
  })
  .partial()
  .refine((v) => v.deficitMode !== 'PERCENT' || (v.deficitValue ?? 0) <= 100, {
    message: 'дефицит в процентах не может превышать 100',
    path: ['deficitValue'],
  });

export type ProfileUpdate = z.infer<typeof profileUpdateSchema>;

/** Профиль как его отдаёт API: те же поля, но все обязательны в ответе. */
export type Profile = {
  sex: z.infer<typeof sex> | null;
  birthYear: number | null;
  heightCm: number | null;
  activityLevel: z.infer<typeof activityLevel>;
  startWeight: number | null;
  goalWeight: number | null;
  deficitMode: z.infer<typeof deficitMode>;
  deficitValue: number;
  proteinPerKg: number | null;
  fatPerKg: number | null;
  kcalTarget: number | null;
  proteinTarget: number | null;
  fatTarget: number | null;
  carbTarget: number | null;
  sweetsBudget: number | null;
  windowStart: string;
  windowEnd: string;
  stepsTarget: number;
  waterTarget: number;
};

export type ProfileResponse = {
  profile: Profile;
  /** Чистый расчёт по формулам — показывается рядом с ручными цифрами. */
  computed: Targets;
  /** Что реально применяется: ручное значение важнее расчётного. */
  effective: EffectiveTargets;
  /** Незаполненные поля, без которых норму не посчитать. */
  missing: MissingField[];
  /** Вес, от которого считался BMR, и откуда он взят. */
  weight: { kg: number | null; source: 'MEASURED' | 'START' | 'NONE' };
};
