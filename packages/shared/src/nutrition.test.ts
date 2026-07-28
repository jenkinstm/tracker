import { describe, expect, it } from 'vitest';

import {
  ACTIVITY_FACTORS,
  DEFAULT_DEFICIT,
  MIN_TARGET_KCAL,
  calcAge,
  calcBmr,
  calcCarbTarget,
  calcMacroTargets,
  calcSweetsBudget,
  calcTargetKcal,
  calcTdee,
  computeTargets,
  effectiveTargets,
  type TargetsInput,
} from './nutrition.js';

const TODAY = new Date('2026-07-28T12:00:00Z');

describe('calcAge', () => {
  it('считает возраст по году рождения', () => {
    expect(calcAge(1985, TODAY)).toBe(41);
  });

  it('в год рождения возраст ноль', () => {
    expect(calcAge(2026, TODAY)).toBe(0);
  });

  it('год в будущем — не возраст', () => {
    expect(calcAge(2030, TODAY)).toBeNull();
  });

  it('нереальный возраст отбрасывается', () => {
    expect(calcAge(1800, TODAY)).toBeNull();
  });

  it('пустой год рождения даёт null', () => {
    expect(calcAge(null, TODAY)).toBeNull();
    expect(calcAge(undefined, TODAY)).toBeNull();
    expect(calcAge(0, TODAY)).toBeNull();
  });

  it('дробный год рождения отбрасывается', () => {
    expect(calcAge(1985.5, TODAY)).toBeNull();
  });
});

describe('calcBmr', () => {
  // Ручная сверка по формуле из context.md:
  // 10×124 + 6.25×183 − 5×41 + 5 = 1240 + 1143.75 − 205 + 5 = 2183.75
  it('мужчина: совпадает с ручным расчётом', () => {
    expect(calcBmr({ sex: 'MALE', weightKg: 124, heightCm: 183, ageYears: 41 })).toBe(2184);
  });

  // 10×70 + 6.25×165 − 5×30 − 161 = 700 + 1031.25 − 150 − 161 = 1420.25
  it('женщина: свободный член −161', () => {
    expect(calcBmr({ sex: 'FEMALE', weightKg: 70, heightCm: 165, ageYears: 30 })).toBe(1420);
  });

  it('разница между полами при прочих равных — ровно 166 ккал', () => {
    const male = calcBmr({ sex: 'MALE', weightKg: 80, heightCm: 175, ageYears: 35 })!;
    const female = calcBmr({ sex: 'FEMALE', weightKg: 80, heightCm: 175, ageYears: 35 })!;
    expect(male - female).toBe(166);
  });

  it('без пола расчёт невозможен', () => {
    expect(calcBmr({ sex: null, weightKg: 80, heightCm: 175, ageYears: 35 })).toBeNull();
  });

  it('нулевой и отрицательный вес или рост дают null', () => {
    expect(calcBmr({ sex: 'MALE', weightKg: 0, heightCm: 175, ageYears: 35 })).toBeNull();
    expect(calcBmr({ sex: 'MALE', weightKg: -5, heightCm: 175, ageYears: 35 })).toBeNull();
    expect(calcBmr({ sex: 'MALE', weightKg: 80, heightCm: 0, ageYears: 35 })).toBeNull();
  });

  it('пустой возраст даёт null', () => {
    expect(calcBmr({ sex: 'MALE', weightKg: 80, heightCm: 175, ageYears: null })).toBeNull();
  });

  it('нулевой возраст — допустимое значение, а не пропуск', () => {
    expect(calcBmr({ sex: 'MALE', weightKg: 10, heightCm: 75, ageYears: 0 })).toBe(574);
  });
});

describe('calcTdee', () => {
  it('умножает BMR на коэффициент активности', () => {
    expect(calcTdee(2000, 'SEDENTARY')).toBe(2400);
    expect(calcTdee(2000, 'LIGHT')).toBe(2750);
    expect(calcTdee(2000, 'MODERATE')).toBe(3100);
    expect(calcTdee(2000, 'HIGH')).toBe(3450);
    expect(calcTdee(2000, 'ATHLETE')).toBe(3800);
  });

  it('коэффициенты совпадают с зафиксированными в context.md', () => {
    expect(Object.values(ACTIVITY_FACTORS)).toEqual([1.2, 1.375, 1.55, 1.725, 1.9]);
  });

  it('без BMR нет TDEE', () => {
    expect(calcTdee(null, 'LIGHT')).toBeNull();
    expect(calcTdee(0, 'LIGHT')).toBeNull();
  });
});

describe('calcTargetKcal', () => {
  it('процентный дефицит', () => {
    expect(calcTargetKcal(3000, { mode: 'PERCENT', value: 20 })).toBe(2400);
  });

  it('дефицит в килокалориях', () => {
    expect(calcTargetKcal(3000, { mode: 'KCAL', value: 800 })).toBe(2200);
  });

  it('нулевой дефицит оставляет норму на уровне TDEE', () => {
    expect(calcTargetKcal(2750, { mode: 'PERCENT', value: 0 })).toBe(2750);
  });

  it('дефицит больше TDEE упирается в нижний порог, а не уходит в минус', () => {
    expect(calcTargetKcal(2000, { mode: 'KCAL', value: 5000 })).toBe(MIN_TARGET_KCAL);
    expect(calcTargetKcal(2000, { mode: 'PERCENT', value: 100 })).toBe(MIN_TARGET_KCAL);
  });

  it('при TDEE ниже порога норма не превращается в профицит', () => {
    expect(calcTargetKcal(1000, { mode: 'PERCENT', value: 50 })).toBe(1000);
  });

  it('норма округляется до десятков', () => {
    expect(calcTargetKcal(2183, { mode: 'PERCENT', value: 13 })).toBe(1900);
  });

  it('без TDEE нет нормы', () => {
    expect(calcTargetKcal(null, DEFAULT_DEFICIT)).toBeNull();
  });
});

describe('calcCarbTarget', () => {
  it('углеводы — остаток калорий после белка и жира', () => {
    // 2200 − 160×4 − 80×9 = 2200 − 640 − 720 = 840 ккал → 210 г
    expect(calcCarbTarget(2200, 160, 80)).toBe(210);
  });

  it('если белок и жир съели всю норму, остаток нулевой, а не отрицательный', () => {
    expect(calcCarbTarget(1000, 200, 50)).toBe(0);
  });

  it('без нормы или без макросов остаток не считается', () => {
    expect(calcCarbTarget(null, 160, 80)).toBeNull();
    expect(calcCarbTarget(2200, null, 80)).toBeNull();
    expect(calcCarbTarget(2200, 160, null)).toBeNull();
  });
});

describe('calcMacroTargets', () => {
  it('белок и жир считаются от опорного веса', () => {
    const macros = calcMacroTargets({ kcalTarget: 2200, basisWeightKg: 90 });
    expect(macros.protein).toBe(162); // 90 × 1.8
    expect(macros.fat).toBe(81); // 90 × 0.9
    expect(macros.carb).toBe(206); // (2200 − 162×4 − 81×9) / 4
  });

  it('своя норма белка на килограмм перекрывает дефолт', () => {
    const macros = calcMacroTargets({ kcalTarget: 2200, basisWeightKg: 90, proteinPerKg: 2.2 });
    expect(macros.protein).toBe(198);
  });

  it('нулевой опорный вес не даёт делить норму на пустоту', () => {
    const macros = calcMacroTargets({ kcalTarget: 2200, basisWeightKg: 0 });
    expect(macros).toEqual({ protein: null, fat: null, carb: null });
  });

  it('без опорного веса макросы не считаются', () => {
    const macros = calcMacroTargets({ kcalTarget: 2200, basisWeightKg: null });
    expect(macros).toEqual({ protein: null, fat: null, carb: null });
  });

  it('сумма макросов сходится с нормой калорий', () => {
    const kcal = 2200;
    const m = calcMacroTargets({ kcalTarget: kcal, basisWeightKg: 90 });
    const sum = m.protein! * 4 + m.fat! * 9 + m.carb! * 4;
    expect(Math.abs(sum - kcal)).toBeLessThanOrEqual(5); // расхождение только от округления
  });
});

describe('calcSweetsBudget', () => {
  it('десятая часть нормы, округлённая до десятков', () => {
    expect(calcSweetsBudget(2200)).toBe(220);
  });

  it('доля настраивается', () => {
    expect(calcSweetsBudget(2200, 0.05)).toBe(110);
  });

  it('без нормы подбюджета нет', () => {
    expect(calcSweetsBudget(null)).toBeNull();
    expect(calcSweetsBudget(0)).toBeNull();
  });
});

describe('computeTargets', () => {
  const full: TargetsInput = {
    sex: 'MALE',
    birthYear: 1985,
    heightCm: 183,
    weightKg: 124,
    goalWeightKg: 90,
    activityLevel: 'LIGHT',
    deficit: DEFAULT_DEFICIT,
    proteinPerKg: null,
    fatPerKg: null,
  };

  it('полный профиль: цифры сходятся с ручным расчётом', () => {
    const { targets, missing } = computeTargets(full, TODAY);

    expect(missing).toEqual([]);
    expect(targets.ageYears).toBe(41);
    expect(targets.bmr).toBe(2184); // 10×124 + 6.25×183 − 5×41 + 5
    expect(targets.tdee).toBe(3003); // 2184 × 1.375
    expect(targets.kcal).toBe(2400); // −20%, до десятков
    expect(targets.protein).toBe(162); // 90 × 1.8
    expect(targets.fat).toBe(81); // 90 × 0.9
    expect(targets.carb).toBe(256); // (2400 − 648 − 729) / 4
    expect(targets.sweets).toBe(240);
  });

  it('перечисляет незаполненные поля', () => {
    const { targets, missing } = computeTargets(
      { ...full, sex: null, birthYear: null, heightCm: null, weightKg: null },
      TODAY,
    );

    expect(missing).toEqual(['sex', 'birthYear', 'heightCm', 'weightKg']);
    expect(targets.bmr).toBeNull();
    expect(targets.tdee).toBeNull();
    expect(targets.kcal).toBeNull();
  });

  // Белок и жир зависят только от веса — прятать их за незаполненным полом незачем.
  it('без пола и года рождения макросы всё равно считаются', () => {
    const { targets, missing } = computeTargets({ ...full, sex: null, birthYear: null }, TODAY);

    expect(missing).toEqual(['sex', 'birthYear']);
    expect(targets.bmr).toBeNull();
    expect(targets.kcal).toBeNull();
    expect(targets.protein).toBe(162);
    expect(targets.fat).toBe(81);
    expect(targets.carb).toBeNull(); // остаток не от чего считать
  });

  it('без целевого веса макросы считаются от текущего', () => {
    const { targets } = computeTargets({ ...full, goalWeightKg: null }, TODAY);
    expect(targets.protein).toBe(223); // 124 × 1.8
  });

  it('уровень активности меняет TDEE и норму', () => {
    const sedentary = computeTargets({ ...full, activityLevel: 'SEDENTARY' }, TODAY).targets;
    const athlete = computeTargets({ ...full, activityLevel: 'ATHLETE' }, TODAY).targets;

    expect(sedentary.tdee).toBe(2621);
    expect(athlete.tdee).toBe(4150);
    expect(athlete.kcal! > sedentary.kcal!).toBe(true);
  });
});

describe('effectiveTargets', () => {
  const computed = {
    ageYears: 41,
    bmr: 2184,
    tdee: 3003,
    kcal: 2400,
    protein: 162,
    fat: 81,
    carb: 256,
    sweets: 240,
  };

  const noOverrides = { kcal: null, protein: null, fat: null, carb: null, sweets: null };

  it('без переопределений возвращает расчёт', () => {
    expect(effectiveTargets(computed, noOverrides)).toEqual({
      kcal: 2400,
      protein: 162,
      fat: 81,
      carb: 256,
      sweets: 240,
    });
  });

  it('ручное значение перекрывает расчётное', () => {
    const result = effectiveTargets(computed, { ...noOverrides, kcal: 2200, protein: 160 });
    expect(result.kcal).toBe(2200);
    expect(result.protein).toBe(160);
  });

  // Иначе после правки нормы вручную макросы остались бы от старой цифры.
  it('углеводы пересчитываются от переопределённых калорий', () => {
    const result = effectiveTargets(computed, { ...noOverrides, kcal: 2200, protein: 160 });
    expect(result.carb).toBe(208); // (2200 − 160×4 − 81×9) / 4
    expect(result.sweets).toBe(220);
  });

  it('переопределённые углеводы важнее пересчёта', () => {
    const result = effectiveTargets(computed, { ...noOverrides, kcal: 2200, carb: 150 });
    expect(result.carb).toBe(150);
  });

  it('ноль как переопределение не подменяется расчётом', () => {
    const result = effectiveTargets(computed, { ...noOverrides, sweets: 0 });
    expect(result.sweets).toBe(0);
  });

  // Профиль с дефолтами из context.md, но без пола и года рождения:
  // расчёта нет, а приложением пользоваться уже можно.
  it('ручные цифры работают, когда расчёт невозможен', () => {
    const empty = {
      ageYears: null,
      bmr: null,
      tdee: null,
      kcal: null,
      protein: null,
      fat: null,
      carb: null,
      sweets: null,
    };
    const result = effectiveTargets(empty, {
      ...noOverrides,
      kcal: 2200,
      protein: 160,
      sweets: 200,
    });

    expect(result.kcal).toBe(2200);
    expect(result.protein).toBe(160);
    expect(result.sweets).toBe(200);
    expect(result.fat).toBeNull();
    expect(result.carb).toBeNull(); // без жира остаток не посчитать
  });
});
