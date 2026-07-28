/**
 * Даты дневника.
 *
 * День определяется часовым поясом пользователя, а не поясом процесса:
 * запись в 23:30 по Москве должна попасть в сегодняшний день, даже если
 * сервер живёт в UTC. Поэтому зона передаётся явно, а не берётся из TZ.
 */

export const DEFAULT_TIMEZONE = 'Europe/Moscow';

/** Дата в формате «ГГГГ-ММ-ДД» — так она ходит в API и лежит в колонке DATE. */
export type IsoDate = string;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): value is IsoDate {
  if (!ISO_DATE.test(value)) return false;

  // Формат может пройти регулярку и остаться бессмыслицей: 2026-02-31.
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Сегодняшняя дата в указанном часовом поясе. */
export function todayIso(timezone = DEFAULT_TIMEZONE, now = new Date()): IsoDate {
  return toIsoDate(now, timezone);
}

/** Дата момента в указанном часовом поясе. */
export function toIsoDate(instant: Date, timezone = DEFAULT_TIMEZONE): IsoDate {
  // en-CA даёт как раз «ГГГГ-ММ-ДД», без ручной сборки из частей.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/** Время «ЧЧ:ММ» в указанном часовом поясе — им проставляется время записи. */
export function toTimeOfDay(instant: Date, timezone = DEFAULT_TIMEZONE): string {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(instant);
}

/**
 * Дата из колонки DATE в строку. Prisma отдаёт такие значения как полночь UTC,
 * поэтому переводить их в местный пояс нельзя — сдвинется день.
 */
export function dateColumnToIso(value: Date): IsoDate {
  return value.toISOString().slice(0, 10);
}

/** Строка «ГГГГ-ММ-ДД» в значение для колонки DATE. */
export function isoToDateColumn(value: IsoDate): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

/** Сдвиг на несколько дней — для перелистывания дневника. */
export function shiftIsoDate(date: IsoDate, days: number): IsoDate {
  const shifted = new Date(`${date}T00:00:00.000Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}
