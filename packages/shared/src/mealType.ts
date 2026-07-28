/**
 * Тип приёма пищи (FR-2.3). Проставляется автоматически по времени записи
 * и правится вручную — поэтому границы намеренно грубые, это подсказка,
 * а не классификация.
 */

export type MealType = 'BREAKFAST' | 'LUNCH' | 'DINNER' | 'SNACK';

/** Границы в минутах от полуночи: завтрак 5:00–11:00, обед 11:00–16:00, ужин 16:00–22:00. */
const BOUNDARIES: { until: number; meal: MealType }[] = [
  { until: 5 * 60, meal: 'SNACK' },
  { until: 11 * 60, meal: 'BREAKFAST' },
  { until: 16 * 60, meal: 'LUNCH' },
  { until: 22 * 60, meal: 'DINNER' },
];

/** «ЧЧ:ММ» → минуты от полуночи. Мусор на входе даёт null. */
export function parseTimeOfDay(time: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!match) return null;

  return Number(match[1]) * 60 + Number(match[2]);
}

export function mealTypeByTime(time: string): MealType | null {
  const minutes = parseTimeOfDay(time);
  if (minutes === null) return null;

  for (const { until, meal } of BOUNDARIES) {
    if (minutes < until) return meal;
  }

  // Всё, что позже 22:00, — поздний перекус.
  return 'SNACK';
}
