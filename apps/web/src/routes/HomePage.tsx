import { todayIso } from '@tracker/shared';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import { WaterCounter } from '../components/WaterCounter.js';
import { ru } from '../i18n/ru.js';
import { useDiaryDay } from '../lib/diary.js';
import { useLogout } from '../lib/session.js';

export function HomePage() {
  const logout = useLogout();
  // Дата считается в московском поясе, а не в поясе браузера: иначе поездка
  // на восток переносила бы ужин на завтра.
  const [date] = useState(() => todayIso());
  const { data: day } = useDiaryDay(date);

  return (
    <main className="mx-auto flex max-w-md flex-col gap-6 p-4 pb-24">
      <header className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">{ru.diary.today}</h1>
        <Link to="/profile" className="min-h-11 py-3 text-sm underline">
          {ru.home.openProfile}
        </Link>
      </header>

      {day ? (
        <>
          <Totals day={day} />
          <WaterCounter date={date} glasses={day.water.glasses} target={day.water.target} />
          <Entries day={day} />
        </>
      ) : (
        <p className="text-sm text-slate-500">{ru.common.loading}</p>
      )}

      <button
        type="button"
        onClick={() => logout.mutate()}
        disabled={logout.isPending}
        className="min-h-11 self-start rounded border px-4 text-sm disabled:opacity-50"
      >
        {ru.home.logout}
      </button>

      <div className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white p-4">
        <Link
          to="/add"
          className="mx-auto flex min-h-11 max-w-md items-center justify-center rounded bg-slate-800 font-medium text-white"
        >
          {ru.diary.add}
        </Link>
      </div>
    </main>
  );
}

function Totals({ day }: { day: NonNullable<ReturnType<typeof useDiaryDay>['data']> }) {
  const { remaining, totals, sweetKcal } = day;
  const over = remaining.kcal !== null && remaining.kcal < 0;

  return (
    <section className="flex flex-col gap-3 rounded border border-slate-200 p-3">
      <div className="text-center">
        <p className="text-xs uppercase tracking-wide text-slate-500">
          {over ? ru.diary.overBudget : ru.diary.remainingKcal}
        </p>
        <p className={`text-3xl font-semibold tabular-nums ${over ? 'text-red-700' : ''}`}>
          {remaining.kcal === null ? ru.common.dash : Math.abs(remaining.kcal)}
          <span className="ml-1 text-sm font-normal text-slate-500">ккал</span>
        </p>
        <p className="text-xs text-slate-500">
          {ru.diary.eatenKcal} {totals.kcal}
        </p>
      </div>

      <dl className="grid grid-cols-4 gap-2 text-center">
        <Macro label="Б" eaten={totals.protein} left={remaining.protein} />
        <Macro label="Ж" eaten={totals.fat} left={remaining.fat} />
        <Macro label="У" eaten={totals.carb} left={remaining.carb} />
        <Macro label={ru.diary.sweets} eaten={sweetKcal} left={remaining.sweets} />
      </dl>
    </section>
  );
}

function Macro({ label, eaten, left }: { label: string; eaten: number; left: number | null }) {
  const over = left !== null && left < 0;

  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="tabular-nums">
        <span className={`font-semibold ${over ? 'text-red-700' : ''}`}>{eaten}</span>
        {left !== null && <span className="block text-xs text-slate-500">↓{left}</span>}
      </dd>
    </div>
  );
}

function Entries({ day }: { day: NonNullable<ReturnType<typeof useDiaryDay>['data']> }) {
  if (day.entries.length === 0) {
    return <p className="text-sm text-slate-500">{ru.diary.empty}</p>;
  }

  return (
    <section className="flex flex-col gap-1">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
        {ru.diary.heading}
      </h2>

      <ul className="divide-y divide-slate-100">
        {day.entries.map((entry) => (
          <li key={entry.id}>
            <Link
              to={`/diary/${entry.id}`}
              className="flex min-h-11 items-center gap-3 py-2 text-left"
            >
              <span className="w-11 shrink-0 text-sm tabular-nums text-slate-500">{entry.time}</span>
              <span className="flex-1">
                <span className="block">{entry.name}</span>
                {entry.grams !== null && (
                  <span className="block text-xs text-slate-500">{entry.grams} г</span>
                )}
              </span>
              <span className="shrink-0 tabular-nums">{entry.kcal}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
