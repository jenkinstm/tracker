import { prisma } from '../db.js';

/**
 * Дефолты профиля из docs/context.md — заполняются при первом запуске.
 *
 * Пола и года рождения здесь намеренно нет: их не угадать, а без них не
 * считается BMR. Приложение честно скажет «заполни профиль», вместо того
 * чтобы показывать норму, посчитанную от выдуманного возраста.
 */
const PROFILE_DEFAULTS = {
  heightCm: 183,
  startWeight: 124.0,
  goalWeight: 90.0,
  kcalTarget: 2200,
  proteinTarget: 160,
  sweetsBudget: 200,
  windowStart: '12:00',
  windowEnd: '20:00',
  stepsTarget: 9000,
  waterTarget: 12,
} as const;

/**
 * Проставляет дефолты только в пустые поля: сидер гоняется на каждом старте,
 * и затирать то, что человек уже поправил в настройках, он не должен.
 *
 * Для `windowStart`/`windowEnd`/`stepsTarget`/`waterTarget` в схеме есть
 * значения по умолчанию, совпадающие с этими — на уровне БД они уже проставлены,
 * так что «пустыми» они не бывают и здесь не трогаются.
 */
export async function seedProfileDefaults(userId: string): Promise<string[]> {
  const profile = await prisma.profile.findUniqueOrThrow({ where: { userId } });

  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(PROFILE_DEFAULTS)) {
    if (profile[key as keyof typeof profile] === null) patch[key] = value;
  }

  if (Object.keys(patch).length === 0) return [];

  await prisma.profile.update({ where: { userId }, data: patch });

  return Object.keys(patch);
}
