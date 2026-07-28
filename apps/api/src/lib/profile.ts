import type { Profile as PrismaProfile } from '@prisma/client';
import { type ProfileResponse, computeTargets, effectiveTargets } from '@tracker/shared';

import { prisma } from '../db.js';

/**
 * Текущий вес для BMR: последнее взвешивание, иначе стартовый вес из профиля.
 * Стартовый — это то, что человек ввёл однажды при заполнении профиля, и он
 * устаревает; считать по нему норму спустя месяцы было бы враньём, поэтому
 * источник возвращается наружу и показывается в интерфейсе.
 */
async function resolveCurrentWeight(
  userId: string,
  profile: PrismaProfile,
): Promise<ProfileResponse['weight']> {
  const latest = await prisma.weight.findFirst({
    where: { userId },
    orderBy: { date: 'desc' },
  });

  if (latest) return { kg: latest.kg, source: 'MEASURED' };
  if (profile.startWeight !== null) return { kg: profile.startWeight, source: 'START' };

  return { kg: null, source: 'NONE' };
}

export async function getProfileResponse(userId: string, today = new Date()): Promise<ProfileResponse> {
  const profile = await prisma.profile.findUniqueOrThrow({ where: { userId } });
  const weight = await resolveCurrentWeight(userId, profile);

  const { targets, missing } = computeTargets(
    {
      sex: profile.sex,
      birthYear: profile.birthYear,
      heightCm: profile.heightCm,
      weightKg: weight.kg,
      goalWeightKg: profile.goalWeight,
      activityLevel: profile.activityLevel,
      deficit: { mode: profile.deficitMode, value: profile.deficitValue },
      proteinPerKg: profile.proteinPerKg,
      fatPerKg: profile.fatPerKg,
    },
    today,
  );

  const effective = effectiveTargets(targets, {
    kcal: profile.kcalTarget,
    protein: profile.proteinTarget,
    fat: profile.fatTarget,
    carb: profile.carbTarget,
    sweets: profile.sweetsBudget,
  });

  return {
    profile: {
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
    },
    computed: targets,
    effective,
    missing,
    weight,
  };
}
