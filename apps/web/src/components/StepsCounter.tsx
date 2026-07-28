import { useState } from 'react';

import { ru } from '../i18n/ru.js';
import { useSetSteps, useWorkoutDay } from '../lib/workout.js';

/** Шаги за день — ручной ввод (FR-5.9). */
export function StepsCounter({ date }: { date: string }) {
  const { data } = useWorkoutDay(date);
  const setSteps = useSetSteps(date);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');

  const steps = data?.steps ?? null;
  const target = data?.stepsTarget ?? 0;

  function start() {
    setValue(steps === null ? '' : String(steps));
    setEditing(true);
  }

  function submit() {
    const raw = value.trim();
    const parsed = raw === '' ? null : Number(raw.replace(/\s/g, ''));

    if (parsed !== null && !Number.isFinite(parsed)) return;

    setSteps.mutate(parsed === null ? null : Math.round(parsed), {
      onSuccess: () => setEditing(false),
    });
  }

  return (
    <section className="flex items-baseline justify-between gap-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
        {ru.workout.steps}
      </h2>

      {editing ? (
        <span className="flex gap-2">
          <input
            aria-label={ru.workout.steps}
            type="text"
            inputMode="numeric"
            value={value}
            autoFocus
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && submit()}
            className="min-h-11 w-24 rounded border border-slate-300 px-3 text-base"
          />
          <button
            type="button"
            onClick={submit}
            disabled={setSteps.isPending}
            className="min-h-11 rounded bg-slate-800 px-4 text-sm text-white disabled:opacity-50"
          >
            {ru.workout.save}
          </button>
        </span>
      ) : (
        <button type="button" onClick={start} className="min-h-11 text-sm tabular-nums underline">
          {steps === null ? ru.common.dash : steps} / {target}
        </button>
      )}
    </section>
  );
}
