/** Форматирование чисел, денег и дат. Интерфейс русский, даты — в зоне пользователя. */

export const rubles = (kopecks: number) =>
  new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 2 })
    .format(kopecks / 100);

export const number = (value: number | null | undefined) =>
  value === null || value === undefined ? "—" : new Intl.NumberFormat("ru-RU").format(value);

export const shortDate = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const date = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short" }).format(date);
};

export const fullDate = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const date = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
};

export const dateTime = (iso: string | null | undefined) => {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
};

export const runStatus: Record<string, string> = {
  queued: "в очереди",
  running: "идёт",
  done: "готов",
  partial: "частично",
  failed: "ошибка",
};

export const pluralize = (count: number, one: string, few: string, many: string) => {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
};
