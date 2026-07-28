import { roundTo } from './round.js';

/**
 * Пересчёт КБЖУ продукта на съеденное количество (FR-2.2).
 *
 * Результат этой функции попадает в diary_entries снимком и больше не
 * пересчитывается: правка продукта не должна менять историю задним числом.
 */

/** КБЖУ на 100 г — как они лежат в таблице продуктов. */
export type Per100 = {
  kcal100: number;
  protein100: number;
  fat100: number;
  carb100: number;
};

export type Nutrients = {
  kcal: number;
  protein: number;
  fat: number;
  carb: number;
};

export const ZERO_NUTRIENTS: Nutrients = { kcal: 0, protein: 0, fat: 0, carb: 0 };

/** Как задано количество: в граммах, в штуках или в порциях продукта. */
export type AmountUnit =
  | { kind: 'GRAMS' }
  | { kind: 'PIECE'; gramsPerUnit: number }
  | { kind: 'PORTION'; gramsPerPortion: number };

/**
 * Количество → граммы. Всё внутри считается в граммах: штуки и порции живут
 * только в интерфейсе, в БД уезжает вес.
 */
export function amountToGrams(amount: number, unit: AmountUnit): number | null {
  if (!Number.isFinite(amount) || amount < 0) return null;

  const perUnit =
    unit.kind === 'GRAMS' ? 1 : unit.kind === 'PIECE' ? unit.gramsPerUnit : unit.gramsPerPortion;

  if (!Number.isFinite(perUnit) || perUnit <= 0) return null;

  return roundTo(amount * perUnit, 1);
}

/**
 * КБЖУ за указанный вес. Ноль граммов — валидный ответ (ноль калорий),
 * а не отсутствие данных: человек мог обнулить количество в форме.
 */
export function scaleNutrients(per100: Per100, grams: number): Nutrients | null {
  if (!Number.isFinite(grams) || grams < 0) return null;

  const factor = grams / 100;

  return {
    kcal: roundTo(per100.kcal100 * factor, 1),
    protein: roundTo(per100.protein100 * factor, 1),
    fat: roundTo(per100.fat100 * factor, 1),
    carb: roundTo(per100.carb100 * factor, 1),
  };
}

/** Итоги дня. Пустой день — нули, а не null: ноль съеденного тоже результат. */
export function sumNutrients(entries: readonly Nutrients[]): Nutrients {
  const total = entries.reduce(
    (acc, entry) => ({
      kcal: acc.kcal + entry.kcal,
      protein: acc.protein + entry.protein,
      fat: acc.fat + entry.fat,
      carb: acc.carb + entry.carb,
    }),
    ZERO_NUTRIENTS,
  );

  return {
    kcal: roundTo(total.kcal, 1),
    protein: roundTo(total.protein, 1),
    fat: roundTo(total.fat, 1),
    carb: roundTo(total.carb, 1),
  };
}

/**
 * Остаток от нормы. Отрицательный остаток не срезается: перебор нужно
 * видеть, иначе индикатор врёт в самый важный момент.
 */
export function remaining(target: number | null, consumed: number): number | null {
  if (target === null || !Number.isFinite(target)) return null;
  return roundTo(target - consumed, 1);
}

/** Сколько сладкого съедено — считается только по записям с флагом (FR-1.5). */
export function sumSweetKcal(entries: readonly { kcal: number; isSweet: boolean }[]): number {
  return roundTo(
    entries.reduce((sum, entry) => (entry.isSweet ? sum + entry.kcal : sum), 0),
    1,
  );
}
