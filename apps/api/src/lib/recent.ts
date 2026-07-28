import type { RecentFood, RecentResponse } from '@tracker/shared';

import { prisma } from '../db.js';
import { foodToInfo } from './foodSearch.js';

/**
 * «Недавние» и «частые» (FR-2.6) — главный инструмент сценария S1.
 *
 * Возвращается вес прошлого раза: тап по продукту должен добавлять его сразу,
 * без экрана с количеством. Именно это укладывает запись в три тапа.
 */

const LIMIT = 20;
/** Окно для подсчёта частоты: что ел полгода назад, сегодня не показатель. */
const FREQUENT_WINDOW_DAYS = 30;

type RecentRow = {
  food_id: string;
  last_grams: number | null;
  last_used_at: Date;
  use_count: bigint;
};

export async function getRecentFoods(userId: string): Promise<RecentResponse> {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - FREQUENT_WINDOW_DAYS);

  // DISTINCT ON схлопывает историю до одной строки на продукт, оставляя
  // самую свежую — из неё берётся вес прошлого раза.
  const rows = await prisma.$queryRaw<RecentRow[]>`
    SELECT DISTINCT ON (food_id)
           food_id,
           grams      AS last_grams,
           created_at AS last_used_at,
           count(*) OVER (PARTITION BY food_id) AS use_count
    FROM diary_entries
    WHERE user_id = ${userId} AND food_id IS NOT NULL
    ORDER BY food_id, created_at DESC
  `;

  if (rows.length === 0) return { recent: [], frequent: [] };

  const foods = await prisma.food.findMany({
    where: { id: { in: rows.map((row) => row.food_id) } },
    include: { units: { orderBy: { grams: 'asc' } } },
  });
  const byId = new Map(foods.map((food) => [food.id, food]));

  const items: RecentFood[] = rows.flatMap((row) => {
    const food = byId.get(row.food_id);
    if (!food) return [];

    return [
      {
        ...foodToInfo(food),
        lastGrams: row.last_grams ?? food.defaultPortionG ?? 100,
        lastUsedAt: row.last_used_at.toISOString(),
        useCount: Number(row.use_count),
      },
    ];
  });

  const recent = [...items]
    .sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt))
    .slice(0, LIMIT);

  const sinceIso = since.toISOString();
  const frequent = [...items]
    .filter((item) => item.lastUsedAt >= sinceIso)
    .sort((a, b) => b.useCount - a.useCount || b.lastUsedAt.localeCompare(a.lastUsedAt))
    .slice(0, LIMIT);

  return { recent, frequent };
}
