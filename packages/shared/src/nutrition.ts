/**
 * Расчёт нормы калорий и макросов (FR-1.2, FR-1.4, FR-1.5).
 * Формулы зафиксированы в docs/context.md, менять их можно только там же.
 */

export type Sex = 'MALE' | 'FEMALE';

export type ActivityLevel = 'SEDENTARY' | 'LIGHT' | 'MODERATE' | 'HIGH' | 'ATHLETE';

/** Коэффициенты к BMR из docs/context.md. */
export const ACTIVITY_FACTORS: Record<ActivityLevel, number> = {
  SEDENTARY: 1.2,
  LIGHT: 1.375,
  MODERATE: 1.55,
  HIGH: 1.725,
  ATHLETE: 1.9,
};

export type DeficitMode = 'PERCENT' | 'KCAL';

export type Deficit = { mode: DeficitMode; value: number };

export const DEFAULT_DEFICIT: Deficit = { mode: 'PERCENT', value: 20 };
export const DEFAULT_PROTEIN_PER_KG = 1.8;
export const DEFAULT_FAT_PER_KG = 0.9;
/** Доля общей нормы, уходящая в подбюджет сладкого (FR-1.5). */
export const DEFAULT_SWEETS_SHARE = 0.1;

/**
 * Ниже этого порога норму не опускаем даже при огромном дефиците: такая
 * «цель» вредна и всё равно не выполняется. Если TDEE сам ниже порога —
 * упираемся в TDEE, иначе получился бы профицит вместо дефицита.
 */
export const MIN_TARGET_KCAL = 1200;

const KCAL_PER_G = { protein: 4, fat: 9, carb: 4 };

function isPositive(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * Возраст в годах. Известен только год рождения, поэтому точность — год:
 * для BMR этого достаточно, разница в один год двигает результат на 5 ккал.
 */
export function calcAge(birthYear: number | null | undefined, today: Date): number | null {
  if (!isPositive(birthYear) || !Number.isInteger(birthYear)) return null;

  const age = today.getFullYear() - birthYear;
  // Отсекаем опечатки в годе рождения: 2 025 вместо 1 985 и подобное.
  if (age < 0 || age > 120) return null;

  return age;
}

/** BMR по Миффлину–Сан Жеору. Женский вариант отличается свободным членом. */
export function calcBmr(input: {
  sex: Sex | null | undefined;
  weightKg: number | null | undefined;
  heightCm: number | null | undefined;
  ageYears: number | null | undefined;
}): number | null {
  const { sex, weightKg, heightCm, ageYears } = input;

  if (!sex) return null;
  if (!isPositive(weightKg) || !isPositive(heightCm)) return null;
  if (typeof ageYears !== 'number' || !Number.isFinite(ageYears) || ageYears < 0) return null;

  const base = 10 * weightKg + 6.25 * heightCm - 5 * ageYears;
  const bmr = sex === 'MALE' ? base + 5 : base - 161;

  // Экстремально низкий вес и рост могут дать отрицательное число — это не BMR.
  return bmr > 0 ? Math.round(bmr) : null;
}

export function calcTdee(bmr: number | null, activityLevel: ActivityLevel): number | null {
  if (!isPositive(bmr)) return null;
  return Math.round(bmr * ACTIVITY_FACTORS[activityLevel]);
}

/** Целевые калории = TDEE − дефицит, с полом по MIN_TARGET_KCAL. */
export function calcTargetKcal(tdee: number | null, deficit: Deficit): number | null {
  if (!isPositive(tdee)) return null;

  const cut = deficit.mode === 'PERCENT' ? (tdee * deficit.value) / 100 : deficit.value;
  const floor = Math.min(MIN_TARGET_KCAL, tdee);

  return Math.max(floor, roundTo10(tdee - cut));
}

/**
 * Белок и жир считаются от целевого веса, а не текущего: норма должна вести
 * к цели, а не обслуживать нынешнюю массу. Углеводы — остаток калорий.
 */
export function calcMacroTargets(input: {
  kcalTarget: number | null;
  basisWeightKg: number | null | undefined;
  proteinPerKg?: number | null;
  fatPerKg?: number | null;
}): { protein: number | null; fat: number | null; carb: number | null } {
  const { kcalTarget, basisWeightKg } = input;
  const proteinPerKg = input.proteinPerKg ?? DEFAULT_PROTEIN_PER_KG;
  const fatPerKg = input.fatPerKg ?? DEFAULT_FAT_PER_KG;

  const protein = isPositive(basisWeightKg) ? Math.round(basisWeightKg * proteinPerKg) : null;
  const fat = isPositive(basisWeightKg) ? Math.round(basisWeightKg * fatPerKg) : null;

  return { protein, fat, carb: calcCarbTarget(kcalTarget, protein, fat) };
}

/**
 * Углеводы = что осталось от нормы после белка и жира. Если белок с жиром
 * уже съели всю норму (бывает при ручном переопределении), остаток — ноль,
 * а не отрицательное число.
 */
export function calcCarbTarget(
  kcalTarget: number | null,
  protein: number | null,
  fat: number | null,
): number | null {
  if (!isPositive(kcalTarget) || protein === null || fat === null) return null;

  const rest = kcalTarget - protein * KCAL_PER_G.protein - fat * KCAL_PER_G.fat;
  return Math.max(0, Math.round(rest / KCAL_PER_G.carb));
}

export function calcSweetsBudget(kcalTarget: number | null, share = DEFAULT_SWEETS_SHARE): number | null {
  if (!isPositive(kcalTarget)) return null;
  return roundTo10(kcalTarget * share);
}

function roundTo10(value: number): number {
  return Math.round(value / 10) * 10;
}

// ─────────────────────────────────────────── сборка целей профиля

/** Поле, без которого расчёт нормы невозможен. */
export type MissingField = 'sex' | 'birthYear' | 'heightCm' | 'weightKg';

export type Targets = {
  ageYears: number | null;
  bmr: number | null;
  tdee: number | null;
  kcal: number | null;
  protein: number | null;
  fat: number | null;
  carb: number | null;
  sweets: number | null;
};

export type TargetsInput = {
  sex: Sex | null;
  birthYear: number | null;
  heightCm: number | null;
  /** Текущий вес: последнее взвешивание, при его отсутствии — стартовый. */
  weightKg: number | null;
  goalWeightKg: number | null;
  activityLevel: ActivityLevel;
  deficit: Deficit;
  proteinPerKg: number | null;
  fatPerKg: number | null;
};

/**
 * Каждая цифра считается независимо и может остаться null. Белок и жир,
 * например, не зависят от пола и возраста — незачем прятать их за
 * незаполненным годом рождения.
 */
export function computeTargets(
  input: TargetsInput,
  today: Date,
): { targets: Targets; missing: MissingField[] } {
  const missing: MissingField[] = [];
  if (!input.sex) missing.push('sex');
  if (calcAge(input.birthYear, today) === null) missing.push('birthYear');
  if (!isPositive(input.heightCm)) missing.push('heightCm');
  if (!isPositive(input.weightKg)) missing.push('weightKg');

  const ageYears = calcAge(input.birthYear, today);
  const bmr = calcBmr({
    sex: input.sex,
    weightKg: input.weightKg,
    heightCm: input.heightCm,
    ageYears,
  });
  const tdee = calcTdee(bmr, input.activityLevel);
  const kcal = calcTargetKcal(tdee, input.deficit);

  // Целевой вес — основа для белка и жира; пока он не задан, считаем от текущего.
  const basisWeightKg = isPositive(input.goalWeightKg) ? input.goalWeightKg : input.weightKg;
  const macros = calcMacroTargets({
    kcalTarget: kcal,
    basisWeightKg,
    proteinPerKg: input.proteinPerKg,
    fatPerKg: input.fatPerKg,
  });

  return {
    targets: { ageYears, bmr, tdee, kcal, ...macros, sweets: calcSweetsBudget(kcal) },
    missing,
  };
}

export type TargetOverrides = {
  kcal: number | null;
  protein: number | null;
  fat: number | null;
  carb: number | null;
  sweets: number | null;
};

export type EffectiveTargets = Omit<Targets, 'ageYears' | 'bmr' | 'tdee'>;

/**
 * Что реально применяется: ручное значение важнее расчётного (FR-1.3).
 *
 * Углеводы пересчитываются от уже подменённых калорий, белка и жира —
 * иначе правка нормы вручную оставила бы углеводы от старой цифры,
 * и сумма макросов перестала бы сходиться с калориями.
 */
export function effectiveTargets(computed: Targets, overrides: TargetOverrides): EffectiveTargets {
  const kcal = overrides.kcal ?? computed.kcal;
  const protein = overrides.protein ?? computed.protein;
  const fat = overrides.fat ?? computed.fat;

  return {
    kcal,
    protein,
    fat,
    carb: overrides.carb ?? calcCarbTarget(kcal, protein, fat) ?? computed.carb,
    sweets: overrides.sweets ?? calcSweetsBudget(kcal) ?? computed.sweets,
  };
}
