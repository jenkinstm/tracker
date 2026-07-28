import { describe, expect, it } from 'vitest';

import { profileUpdateSchema } from './profile.js';

describe('profileUpdateSchema', () => {
  it('принимает частичное обновление', () => {
    const result = profileUpdateSchema.safeParse({ heightCm: 183 });
    expect(result.success).toBe(true);
  });

  it('принимает пустой объект: менять ничего не обязательно', () => {
    expect(profileUpdateSchema.safeParse({}).success).toBe(true);
  });

  // null — это «считай по формуле» (FR-1.3), он обязан проходить валидацию.
  it('null в переопределениях допустим', () => {
    const result = profileUpdateSchema.safeParse({
      kcalTarget: null,
      proteinTarget: null,
      sweetsBudget: null,
      sex: null,
    });
    expect(result.success).toBe(true);
  });

  it('отбрасывает нереальный рост и год рождения', () => {
    expect(profileUpdateSchema.safeParse({ heightCm: 5 }).success).toBe(false);
    expect(profileUpdateSchema.safeParse({ heightCm: 300 }).success).toBe(false);
    expect(profileUpdateSchema.safeParse({ birthYear: 1800 }).success).toBe(false);
  });

  it('отбрасывает дробный год рождения и рост', () => {
    expect(profileUpdateSchema.safeParse({ birthYear: 1985.5 }).success).toBe(false);
    expect(profileUpdateSchema.safeParse({ heightCm: 183.5 }).success).toBe(false);
  });

  it('вес принимает дробные значения', () => {
    expect(profileUpdateSchema.safeParse({ startWeight: 124.4 }).success).toBe(true);
  });

  it('процентный дефицит не может превышать 100', () => {
    expect(
      profileUpdateSchema.safeParse({ deficitMode: 'PERCENT', deficitValue: 120 }).success,
    ).toBe(false);
    expect(profileUpdateSchema.safeParse({ deficitMode: 'PERCENT', deficitValue: 20 }).success).toBe(
      true,
    );
  });

  it('дефицит в килокалориях процентным потолком не ограничен', () => {
    expect(profileUpdateSchema.safeParse({ deficitMode: 'KCAL', deficitValue: 800 }).success).toBe(
      true,
    );
  });

  it('отрицательный дефицит не принимается', () => {
    expect(profileUpdateSchema.safeParse({ deficitValue: -100 }).success).toBe(false);
  });

  it('проверяет формат времени окна питания', () => {
    expect(profileUpdateSchema.safeParse({ windowStart: '12:00' }).success).toBe(true);
    expect(profileUpdateSchema.safeParse({ windowStart: '24:00' }).success).toBe(false);
    expect(profileUpdateSchema.safeParse({ windowStart: '9:00' }).success).toBe(false);
    expect(profileUpdateSchema.safeParse({ windowStart: 'полдень' }).success).toBe(false);
  });

  it('не принимает неизвестный уровень активности', () => {
    expect(profileUpdateSchema.safeParse({ activityLevel: 'SUPER' }).success).toBe(false);
  });
});
