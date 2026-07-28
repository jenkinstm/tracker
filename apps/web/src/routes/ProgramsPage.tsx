import { Link, useNavigate } from 'react-router-dom';

import { ru } from '../i18n/ru.js';
import { useCreateProgram, useDeleteProgram, usePrograms } from '../lib/workout.js';

/** Список программ (FR-5.2). */
export function ProgramsPage() {
  const navigate = useNavigate();
  const { data: programs, isPending } = usePrograms();
  const create = useCreateProgram();
  const remove = useDeleteProgram();

  function addProgram() {
    create.mutate(
      { name: ru.workout.newProgram, items: [] },
      { onSuccess: (program) => navigate(`/programs/${(program as { id: string }).id}`) },
    );
  }

  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 p-4">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{ru.workout.programs}</h1>
        <Link to="/workout" className="min-h-11 py-3 text-sm underline">
          {ru.common.back}
        </Link>
      </header>

      {isPending ? (
        <p className="text-sm text-slate-500">{ru.common.loading}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {programs?.map((program) => (
            <li key={program.id} className="flex items-stretch gap-2">
              <Link
                to={`/programs/${program.id}`}
                className="flex min-h-11 flex-1 flex-col justify-center rounded border border-slate-300 p-3"
              >
                <span className="font-medium">{program.name}</span>
                <span className="text-xs text-slate-500">
                  {program.items.length === 0
                    ? ru.workout.emptyProgram
                    : program.items.map((item) => item.exercise.name).join(', ')}
                </span>
              </Link>

              <button
                type="button"
                aria-label={ru.workout.deleteProgram}
                disabled={remove.isPending}
                onClick={() => {
                  if (window.confirm(ru.workout.deleteProgramConfirm)) remove.mutate(program.id);
                }}
                className="min-h-11 w-11 shrink-0 rounded border border-slate-300 text-slate-400 disabled:opacity-50"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={addProgram}
        disabled={create.isPending}
        className="min-h-11 rounded bg-slate-800 text-white disabled:opacity-50"
      >
        {ru.workout.newProgram}
      </button>
    </main>
  );
}
