import { ru } from '../i18n/ru.js';
import { useSetWater } from '../lib/diary.js';

/** Счётчик стаканов (FR-2.13): тап по стакану ставит количество выпитого. */
export function WaterCounter({
  date,
  glasses,
  target,
}: {
  date: string;
  glasses: number;
  target: number;
}) {
  const setWater = useSetWater(date);

  // Показываем всегда минимум цель: иначе не видно, сколько ещё осталось.
  const shown = Math.max(target, glasses);

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          {ru.diary.water}
        </h2>
        <span className="text-sm tabular-nums text-slate-600">
          {glasses} / {target} {ru.diary.waterGlasses}
        </span>
      </div>

      <div className="flex flex-wrap gap-1">
        {Array.from({ length: shown }, (_, index) => {
          const filled = index < glasses;
          // Повторный тап по последнему налитому стакану убирает его —
          // иначе промах вправо не отменить.
          const next = filled && index === glasses - 1 ? index : index + 1;

          return (
            <button
              key={index}
              type="button"
              aria-label={`${index + 1}`}
              aria-pressed={filled}
              disabled={setWater.isPending}
              onClick={() => setWater.mutate(next)}
              className={`h-11 w-8 rounded border text-lg leading-none disabled:opacity-50 ${
                filled ? 'border-sky-500 bg-sky-100' : 'border-slate-300'
              }`}
            >
              {filled ? '▮' : '▯'}
            </button>
          );
        })}
      </div>
    </section>
  );
}
