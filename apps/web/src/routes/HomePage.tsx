import { Link } from 'react-router-dom';

import { ru } from '../i18n/ru.js';
import { useProfile } from '../lib/profile.js';
import { useLogout } from '../lib/session.js';

export function HomePage() {
  const logout = useLogout();
  const { data } = useProfile();

  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 p-4">
      <h1 className="text-xl font-semibold">{ru.home.heading}</h1>

      <section className="flex flex-col gap-3 rounded border border-slate-200 p-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          {ru.home.targetsHeading}
        </h2>

        {data ? (
          <>
            <dl className="grid grid-cols-4 gap-2 text-center">
              <Target label={ru.profile.kcalTarget} value={data.effective.kcal} />
              <Target label={ru.profile.proteinTarget} value={data.effective.protein} />
              <Target label={ru.profile.fatTarget} value={data.effective.fat} />
              <Target label={ru.profile.carbTarget} value={data.effective.carb} />
            </dl>

            {data.missing.length > 0 && (
              <p className="text-sm text-amber-700">{ru.home.fillProfile}</p>
            )}
          </>
        ) : (
          <p className="text-sm text-slate-500">{ru.common.loading}</p>
        )}

        <Link to="/profile" className="min-h-11 py-3 text-sm underline">
          {ru.home.openProfile}
        </Link>
      </section>

      <p className="text-sm text-slate-500">{ru.home.placeholder}</p>

      <button
        type="button"
        onClick={() => logout.mutate()}
        disabled={logout.isPending}
        className="min-h-11 self-start rounded border px-4 disabled:opacity-50"
      >
        {ru.home.logout}
      </button>
    </main>
  );
}

/** Подписи взяты из формы профиля, поэтому содержат единицы: «Калории, ккал». */
function Target({ label, value }: { label: string; value: number | null }) {
  const [name, unit] = label.split(', ');

  return (
    <div>
      <dt className="text-xs text-slate-500">{name}</dt>
      <dd className="text-lg font-semibold tabular-nums">
        {value === null ? ru.common.dash : value}
        {value !== null && unit && (
          <span className="ml-1 text-xs font-normal text-slate-500">{unit}</span>
        )}
      </dd>
    </div>
  );
}
