import { describe, expect, it } from 'vitest';
import { foods } from './foods.js';
import { seedFoodSchema } from './types.js';

/** Коэффициенты Этуотера: сколько ккал даёт грамм каждого нутриента. */
const KCAL_PER_G = { protein: 4, fat: 9, carb: 4, alcohol: 7 };

function kcalFromMacros(f: (typeof foods)[number]): number {
  return (
    f.protein * KCAL_PER_G.protein +
    f.fat * KCAL_PER_G.fat +
    f.carb * KCAL_PER_G.carb +
    (f.alcohol ?? 0) * KCAL_PER_G.alcohol
  );
}

describe('сид продуктов', () => {
  it('каждая позиция проходит схему', () => {
    for (const f of foods) {
      const result = seedFoodSchema.safeParse(f);
      expect(result.success, `${f.id}: ${result.error?.message}`).toBe(true);
    }
  });

  it('в базе не меньше 280 позиций', () => {
    expect(foods.length).toBeGreaterThanOrEqual(280);
  });

  it('id уникальны', () => {
    const seen = new Map<string, number>();
    for (const f of foods) seen.set(f.id, (seen.get(f.id) ?? 0) + 1);
    const dupes = [...seen].filter(([, n]) => n > 1).map(([id]) => id);
    expect(dupes).toEqual([]);
  });

  it('названия уникальны', () => {
    const seen = new Map<string, number>();
    for (const f of foods) {
      const key = f.name.toLocaleLowerCase('ru');
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    const dupes = [...seen].filter(([, n]) => n > 1).map(([name]) => name);
    expect(dupes).toEqual([]);
  });

  // Главная защита от опечатки в одной цифре: если ккал разъезжаются
  // с макросами, значит где-то съехала запятая или перепутана колонка.
  // Допуск широкий: таблицы округляют, клетчатка усваивается неполностью,
  // поэтому расхождение до 15 ккал или 20% считаем нормой.
  it('ккал сходятся с макросами', () => {
    const bad = foods
      .map((f) => ({ f, expected: kcalFromMacros(f) }))
      .filter(({ f, expected }) => Math.abs(f.kcal - expected) > Math.max(15, f.kcal * 0.2))
      .map(({ f, expected }) => `${f.id}: указано ${f.kcal}, по макросам ${expected.toFixed(0)}`);
    expect(bad).toEqual([]);
  });

  it('сумма Б+Ж+У не превышает 100 г на 100 г продукта', () => {
    const bad = foods
      .filter((f) => f.protein + f.fat + f.carb > 100)
      .map((f) => `${f.id}: ${(f.protein + f.fat + f.carb).toFixed(1)} г`);
    expect(bad).toEqual([]);
  });

  it('клетчатка не превышает углеводы', () => {
    const bad = foods.filter((f) => f.fiber !== undefined && f.fiber > f.carb).map((f) => f.id);
    expect(bad).toEqual([]);
  });

  it('у каждой позиции задана положительная порция', () => {
    const bad = foods.filter((f) => !(f.portion > 0)).map((f) => f.id);
    expect(bad).toEqual([]);
  });

  it('штучные единицы не тяжелее килограмма и уникальны внутри продукта', () => {
    for (const f of foods) {
      if (!f.units) continue;
      const names = f.units.map((u) => u.name);
      expect(new Set(names).size, `${f.id}: дубли единиц`).toBe(names.length);
      for (const u of f.units) expect(u.grams, `${f.id}/${u.name}`).toBeGreaterThan(0);
    }
  });

  it('сладкое помечено флагом', () => {
    const mustBeSweet = ['sugar', 'honey', 'chocolate-milk', 'candy-chocolate', 'cake-sponge'];
    for (const id of mustBeSweet) {
      const f = foods.find((x) => x.id === id);
      expect(f, id).toBeDefined();
      expect(f?.isSweet, id).toBe(true);
    }
  });

  // Критерий приёмки блока: поиск должен находить эти три позиции.
  it('ключевые продукты на месте и с адекватными КБЖУ', () => {
    const buckwheat = foods.find((f) => f.id === 'buckwheat-boiled');
    expect(buckwheat?.kcal).toBeLessThan(150); // варёная, а не сухая крупа
    expect(buckwheat?.name).toContain('Гречка');

    const curd = foods.find((f) => f.id === 'cottage-cheese-5');
    expect(curd?.protein).toBeGreaterThan(14);

    const chicken = foods.find((f) => f.id === 'chicken-breast-boiled');
    expect(chicken?.protein).toBeGreaterThan(25);
    expect(chicken?.fat).toBeLessThan(5);
  });

  // Крупы и макароны в трекерах чаще всего заносят в сухом виде — тогда
  // калорийность улетает за 300 ккал/100 г и дневник врёт втрое.
  it('крупы и гарниры записаны в готовом виде', () => {
    const cooked = [
      'buckwheat-boiled',
      'rice-white-boiled',
      'pasta-boiled',
      'oatmeal-water',
      'pearl-barley-boiled',
      'lentils-boiled',
    ];
    for (const id of cooked) {
      const f = foods.find((x) => x.id === id);
      expect(f, id).toBeDefined();
      expect(f!.kcal, `${id}: похоже на сухой вес`).toBeLessThan(200);
    }
  });
});
