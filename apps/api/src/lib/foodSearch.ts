import { type FoodInfo, queryVariants } from '@tracker/shared';

import { prisma } from '../db.js';

/**
 * Поиск по локальной базе (FR-2.1): подстрочный, регистронезависимый,
 * с учётом раскладки.
 *
 * Запрос гоняется по всем вариантам написания — как набрано и с переключённой
 * раскладкой. Подстрочное совпадение важнее триграммного сходства: «творог»
 * должен выдать все творога, а не «сыр творожный» первым номером.
 */

type SearchRow = {
  id: string;
  user_id: string | null;
  name: string;
  brand: string | null;
  kcal_100: number;
  protein_100: number;
  fat_100: number;
  carb_100: number;
  fiber_100: number | null;
  default_portion_g: number | null;
  is_sweet: boolean;
  source: 'SEED' | 'OWN' | 'OFF';
};

/** Ниже этого триграммного сходства выдача превращается в шум. */
const SIMILARITY_THRESHOLD = 0.3;

export async function searchFoods(
  userId: string,
  query: string,
  limit: number,
): Promise<FoodInfo[]> {
  const variants = queryVariants(query);
  if (variants.length === 0) return [];

  const rows = await prisma.$queryRaw<SearchRow[]>`
    SELECT id, user_id, name, brand, kcal_100, protein_100, fat_100, carb_100,
           fiber_100, default_portion_g, is_sweet, source
    FROM foods
    WHERE (user_id IS NULL OR user_id = ${userId})
      AND EXISTS (
        SELECT 1 FROM unnest(${variants}::text[]) AS v(term)
        WHERE name ILIKE '%' || v.term || '%'
           OR similarity(name, v.term) > ${SIMILARITY_THRESHOLD}
      )
    ORDER BY
      -- Подстрочное совпадение выше похожего по триграммам.
      (SELECT bool_or(name ILIKE '%' || v.term || '%')
       FROM unnest(${variants}::text[]) AS v(term)) DESC,
      -- Свои продукты выше сида: заведены руками, значит нужны чаще.
      (user_id IS NOT NULL) DESC,
      (SELECT max(similarity(name, v.term)) FROM unnest(${variants}::text[]) AS v(term)) DESC,
      length(name) ASC,
      name ASC
    LIMIT ${limit}
  `;

  const units = await loadUnits(rows.map((row) => row.id));

  return rows.map((row) => toFoodInfo(row, units.get(row.id) ?? []));
}

async function loadUnits(foodIds: string[]) {
  if (foodIds.length === 0) return new Map<string, { unitName: string; grams: number }[]>();

  const units = await prisma.foodUnit.findMany({
    where: { foodId: { in: foodIds } },
    orderBy: { grams: 'asc' },
  });

  const byFood = new Map<string, { unitName: string; grams: number }[]>();
  for (const unit of units) {
    const list = byFood.get(unit.foodId) ?? [];
    list.push({ unitName: unit.unitName, grams: unit.grams });
    byFood.set(unit.foodId, list);
  }

  return byFood;
}

function toFoodInfo(row: SearchRow, units: { unitName: string; grams: number }[]): FoodInfo {
  return {
    id: row.id,
    name: row.name,
    brand: row.brand,
    kcal100: row.kcal_100,
    protein100: row.protein_100,
    fat100: row.fat_100,
    carb100: row.carb_100,
    fiber100: row.fiber_100,
    defaultPortionG: row.default_portion_g,
    isSweet: row.is_sweet,
    source: row.source,
    isOwn: row.user_id !== null,
    units,
  };
}

/** Продукт по id — с проверкой, что он общий или принадлежит этому пользователю. */
export async function getAccessibleFood(userId: string, foodId: string) {
  return prisma.food.findFirst({
    where: { id: foodId, OR: [{ userId: null }, { userId }] },
    include: { units: { orderBy: { grams: 'asc' } } },
  });
}

export function foodToInfo(food: {
  id: string;
  userId: string | null;
  name: string;
  brand: string | null;
  kcal100: number;
  protein100: number;
  fat100: number;
  carb100: number;
  fiber100: number | null;
  defaultPortionG: number | null;
  isSweet: boolean;
  source: 'SEED' | 'OWN' | 'OFF';
  units?: { unitName: string; grams: number }[];
}): FoodInfo {
  return {
    id: food.id,
    name: food.name,
    brand: food.brand,
    kcal100: food.kcal100,
    protein100: food.protein100,
    fat100: food.fat100,
    carb100: food.carb100,
    fiber100: food.fiber100,
    defaultPortionG: food.defaultPortionG,
    isSweet: food.isSweet,
    source: food.source,
    isOwn: food.userId !== null,
    units: (food.units ?? []).map((u) => ({ unitName: u.unitName, grams: u.grams })),
  };
}
