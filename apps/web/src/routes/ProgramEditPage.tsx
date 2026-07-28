import type { ProgramInfo } from '@tracker/shared';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { ru } from '../i18n/ru.js';
import { useExercises, usePrograms, useUpdateProgram } from '../lib/workout.js';

type Item = { exerciseId: string; name: string; targetSets: number | null; targetReps: number | null };

/** Редактор программы: состав, порядок, целевые подходы и повторы (FR-5.2). */
export function ProgramEditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: programs, isPending } = usePrograms();
  const { data: exercises } = useExercises();
  const update = useUpdateProgram();

  const program = programs?.find((p) => p.id === id);
  const [draft, setDraft] = useState<{ name: string; items: Item[] } | null>(null);
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState('');

  if (isPending) return <p className="p-4">{ru.common.loading}</p>;
  if (!program) return <NotFound />;

  const current = draft ?? toDraft(program);

  function patch(next: Partial<{ name: string; items: Item[] }>) {
    setDraft({ ...current, ...next });
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= current.items.length) return;

    const items = [...current.items];
    [items[index], items[target]] = [items[target]!, items[index]!];
    patch({ items });
  }

  function save() {
    if (!program) return;

    update.mutate(
      {
        id: program.id,
        name: current.name.trim() || program.name,
        items: current.items.map((item) => ({
          exerciseId: item.exerciseId,
          targetSets: item.targetSets,
          targetReps: item.targetReps,
        })),
      },
      { onSuccess: () => navigate('/programs') },
    );
  }

  const used = new Set(current.items.map((item) => item.exerciseId));
  const available = (exercises ?? []).filter(
    (exercise) =>
      !used.has(exercise.id) && exercise.name.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 p-4 pb-24">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{ru.workout.editProgram}</h1>
        <Link to="/programs" className="min-h-11 py-3 text-sm underline">
          {ru.common.cancel}
        </Link>
      </header>

      <div className="flex flex-col gap-1">
        <label htmlFor="name" className="text-sm text-slate-600">
          {ru.workout.programName}
        </label>
        <input
          id="name"
          type="text"
          value={current.name}
          onChange={(event) => patch({ name: event.target.value })}
          className="min-h-11 rounded border border-slate-300 px-3 text-base"
        />
      </div>

      {current.items.length === 0 && <p className="text-sm text-slate-500">{ru.workout.emptyProgram}</p>}

      <ul className="flex flex-col gap-2">
        {current.items.map((item, index) => (
          <li key={item.exerciseId} className="flex flex-col gap-2 rounded border border-slate-200 p-2">
            <div className="flex items-center gap-2">
              <span className="flex-1">{item.name}</span>
              <button
                type="button"
                aria-label={ru.workout.moveUp}
                onClick={() => move(index, -1)}
                disabled={index === 0}
                className="min-h-11 w-11 rounded border border-slate-300 disabled:opacity-30"
              >
                ↑
              </button>
              <button
                type="button"
                aria-label={ru.workout.moveDown}
                onClick={() => move(index, 1)}
                disabled={index === current.items.length - 1}
                className="min-h-11 w-11 rounded border border-slate-300 disabled:opacity-30"
              >
                ↓
              </button>
              <button
                type="button"
                aria-label={ru.workout.remove}
                onClick={() => patch({ items: current.items.filter((_, i) => i !== index) })}
                className="min-h-11 w-11 rounded border border-slate-300 text-slate-400"
              >
                ✕
              </button>
            </div>

            <div className="flex gap-2">
              <NumberBox
                label={ru.workout.targetSets}
                value={item.targetSets}
                onChange={(value) => patchItem(index, { targetSets: value })}
              />
              <NumberBox
                label={ru.workout.targetReps}
                value={item.targetReps}
                onChange={(value) => patchItem(index, { targetReps: value })}
              />
            </div>
          </li>
        ))}
      </ul>

      {picking ? (
        <section className="flex flex-col gap-2 rounded border border-slate-300 p-3">
          <input
            type="search"
            value={query}
            autoComplete="off"
            placeholder={ru.workout.library}
            onChange={(event) => setQuery(event.target.value)}
            className="min-h-11 rounded border border-slate-300 px-3 text-base"
          />
          <ul className="max-h-64 divide-y divide-slate-100 overflow-y-auto">
            {available.map((exercise) => (
              <li key={exercise.id}>
                <button
                  type="button"
                  onClick={() => {
                    patch({
                      items: [
                        ...current.items,
                        {
                          exerciseId: exercise.id,
                          name: exercise.name,
                          targetSets: 3,
                          targetReps: 10,
                        },
                      ],
                    });
                    setPicking(false);
                    setQuery('');
                  }}
                  className="flex min-h-11 w-full flex-col items-start py-2 text-left"
                >
                  <span>{exercise.name}</span>
                  <span className="text-xs text-slate-500">
                    {ru.workout.group[exercise.muscleGroup]} · {ru.workout.gear[exercise.equipment]}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => setPicking(false)}
            className="min-h-11 rounded border px-4 text-sm"
          >
            {ru.common.cancel}
          </button>
        </section>
      ) : (
        <button
          type="button"
          onClick={() => setPicking(true)}
          className="min-h-11 rounded border border-slate-300"
        >
          {ru.workout.addExercise}
        </button>
      )}

      <div className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white p-4">
        <button
          type="button"
          onClick={save}
          disabled={update.isPending}
          className="mx-auto flex min-h-11 w-full max-w-md items-center justify-center rounded bg-slate-800 font-medium text-white disabled:opacity-50"
        >
          {update.isPending ? ru.workout.saving : ru.workout.save}
        </button>
      </div>

      {update.isError && (
        <p role="alert" className="text-sm text-red-700">
          {ru.workout.saveError}
        </p>
      )}
    </main>
  );

  function patchItem(index: number, values: Partial<Item>) {
    const items = current.items.map((item, i) => (i === index ? { ...item, ...values } : item));
    patch({ items });
  }
}

function toDraft(program: ProgramInfo) {
  return {
    name: program.name,
    items: program.items.map((item) => ({
      exerciseId: item.exercise.id,
      name: item.exercise.name,
      targetSets: item.targetSets,
      targetReps: item.targetReps,
    })),
  };
}

function NumberBox({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  return (
    <label className="flex flex-1 flex-col gap-1">
      <span className="text-xs text-slate-500">{label}</span>
      <input
        type="text"
        inputMode="numeric"
        value={value === null ? '' : String(value)}
        onChange={(event) => {
          const raw = event.target.value.trim();
          if (raw === '') return onChange(null);

          const parsed = Number(raw);
          if (Number.isFinite(parsed)) onChange(Math.round(parsed));
        }}
        className="min-h-11 rounded border border-slate-300 px-3 text-base"
      />
    </label>
  );
}

function NotFound() {
  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 p-4">
      <p>{ru.workout.programs}</p>
      <Link to="/programs" className="min-h-11 py-3 text-sm underline">
        {ru.common.back}
      </Link>
    </main>
  );
}
