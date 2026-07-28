import { describe, expect, it } from 'vitest';

import {
  ZERO_NUTRIENTS,
  amountToGrams,
  remaining,
  scaleNutrients,
  sumNutrients,
  sumSweetKcal,
} from './portion.js';

// Гречка варёная из сида.
const BUCKWHEAT = { kcal100: 92, protein100: 3.4, fat100: 0.6, carb100: 17.1 };

describe('amountToGrams', () => {
  it('граммы остаются граммами', () => {
    expect(amountToGrams(200, { kind: 'GRAMS' })).toBe(200);
  });

  it('штуки умножаются на вес единицы', () => {
    expect(amountToGrams(2, { kind: 'PIECE', gramsPerUnit: 55 })).toBe(110);
  });

  it('порции умножаются на вес порции', () => {
    expect(amountToGrams(1.5, { kind: 'PORTION', gramsPerPortion: 200 })).toBe(300);
  });

  it('ноль — валидное количество', () => {
    expect(amountToGrams(0, { kind: 'GRAMS' })).toBe(0);
    expect(amountToGrams(0, { kind: 'PIECE', gramsPerUnit: 55 })).toBe(0);
  });

  it('дробное число штук допустимо: пол-яйца бывает', () => {
    expect(amountToGrams(0.5, { kind: 'PIECE', gramsPerUnit: 55 })).toBe(27.5);
  });

  it('отрицательное количество отбрасывается', () => {
    expect(amountToGrams(-100, { kind: 'GRAMS' })).toBeNull();
  });

  it('нулевой вес единицы не даёт делить смысл на ноль', () => {
    expect(amountToGrams(2, { kind: 'PIECE', gramsPerUnit: 0 })).toBeNull();
    expect(amountToGrams(2, { kind: 'PORTION', gramsPerPortion: -50 })).toBeNull();
  });

  it('NaN и бесконечность отбрасываются', () => {
    expect(amountToGrams(Number.NaN, { kind: 'GRAMS' })).toBeNull();
    expect(amountToGrams(Number.POSITIVE_INFINITY, { kind: 'GRAMS' })).toBeNull();
  });
});

describe('scaleNutrients', () => {
  it('порция 200 г гречки', () => {
    expect(scaleNutrients(BUCKWHEAT, 200)).toEqual({
      kcal: 184,
      protein: 6.8,
      fat: 1.2,
      carb: 34.2,
    });
  });

  it('ровно 100 г возвращают исходные цифры', () => {
    expect(scaleNutrients(BUCKWHEAT, 100)).toEqual({
      kcal: 92,
      protein: 3.4,
      fat: 0.6,
      carb: 17.1,
    });
  });

  it('ноль граммов — нули, а не отсутствие данных', () => {
    expect(scaleNutrients(BUCKWHEAT, 0)).toEqual(ZERO_NUTRIENTS);
  });

  it('дробный вес округляется до десятых', () => {
    expect(scaleNutrients(BUCKWHEAT, 37)).toEqual({
      kcal: 34,
      protein: 1.3,
      fat: 0.2,
      carb: 6.3,
    });
  });

  it('продукт с нулевыми макросами даёт нули', () => {
    const water = { kcal100: 0, protein100: 0, fat100: 0, carb100: 0 };
    expect(scaleNutrients(water, 250)).toEqual(ZERO_NUTRIENTS);
  });

  it('отрицательный вес отбрасывается', () => {
    expect(scaleNutrients(BUCKWHEAT, -50)).toBeNull();
  });

  it('NaN отбрасывается', () => {
    expect(scaleNutrients(BUCKWHEAT, Number.NaN)).toBeNull();
  });

  it('масло: очень калорийный продукт на малом весе', () => {
    const butter = { kcal100: 748, protein100: 0.5, fat100: 82.5, carb100: 0.8 };
    expect(scaleNutrients(butter, 10)).toEqual({ kcal: 74.8, protein: 0.1, fat: 8.3, carb: 0.1 });
  });
});

describe('sumNutrients', () => {
  it('пустой день — нули', () => {
    expect(sumNutrients([])).toEqual(ZERO_NUTRIENTS);
  });

  it('складывает записи', () => {
    const total = sumNutrients([
      { kcal: 184, protein: 6.8, fat: 1.2, carb: 34.2 },
      { kcal: 205.5, protein: 44.7, fat: 2.7, carb: 0.8 },
    ]);
    expect(total).toEqual({ kcal: 389.5, protein: 51.5, fat: 3.9, carb: 35 });
  });

  it('одна запись возвращается как есть', () => {
    const one = { kcal: 92, protein: 3.4, fat: 0.6, carb: 17.1 };
    expect(sumNutrients([one])).toEqual(one);
  });

  // Накопленная ошибка сложения чисел с плавающей точкой не должна вылезать
  // в интерфейс видом «1499.9999999999998 ккал».
  it('не копит хвост из-за плавающей точки', () => {
    const tenth = { kcal: 0.1, protein: 0.1, fat: 0.1, carb: 0.1 };
    expect(sumNutrients(Array.from({ length: 10 }, () => tenth))).toEqual({
      kcal: 1,
      protein: 1,
      fat: 1,
      carb: 1,
    });
  });
});

describe('remaining', () => {
  it('остаток от нормы', () => {
    expect(remaining(2200, 1500)).toBe(700);
  });

  it('перебор показывается отрицательным числом, а не нулём', () => {
    expect(remaining(2200, 2500)).toBe(-300);
  });

  it('ничего не съедено — остаток равен норме', () => {
    expect(remaining(2200, 0)).toBe(2200);
  });

  it('без нормы нет и остатка', () => {
    expect(remaining(null, 1500)).toBeNull();
  });
});

describe('sumSweetKcal', () => {
  it('считает только помеченные записи', () => {
    expect(
      sumSweetKcal([
        { kcal: 184, isSweet: false },
        { kcal: 137.5, isSweet: true },
        { kcal: 80, isSweet: true },
      ]),
    ).toBe(217.5);
  });

  it('без сладкого — ноль', () => {
    expect(sumSweetKcal([{ kcal: 184, isSweet: false }])).toBe(0);
  });

  it('пустой день — ноль', () => {
    expect(sumSweetKcal([])).toBe(0);
  });
});
