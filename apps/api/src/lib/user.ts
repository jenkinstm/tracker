import { prisma } from '../db.js';

/**
 * Приложение однопользовательское: регистрации нет, аккаунт заводится сам
 * при первом старте. Профиль создаётся пустым — цели считаются в блоке 3.
 */
export async function getSingleUser() {
  const existing = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } });
  if (existing) return existing;

  return prisma.user.create({
    data: { profile: { create: {} } },
  });
}
