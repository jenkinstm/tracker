import type { WorkoutDay, WorkoutExercise, WorkoutInfo } from '@tracker/shared';
import { todayIso } from '@tracker/shared';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import { SetRow } from '../components/SetRow.js';
import { ru } from '../i18n/ru.js';
import {
  useAddSet,
  useDeleteWorkout,
  useExercises,
  useStartWorkout,
  useWorkoutDay,
} from '../lib/workout.js';

export function WorkoutPage() {
  const [date] = useState(() => todayIso());
  const { data, isPending } = useWorkoutDay(date);

  if (isPending) return <p className="p-4">{ru.common.loading}</p>;

  return (
    <main className="mx-auto flex max-w-md flex-col gap-6 p-4">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{ru.workout.heading}</h1>
        <Link to="/" className="min-h-11 py-3 text-sm underline">
          {ru.common.back}
        </Link>
      </header>

      {data?.workout ? (
        <ActiveWorkout day={data} workout={data.workout} />
      ) : (
        <StartWorkout day={data} date={date} />
      )}

      <div className="flex gap-4">
        <Link to="/programs" className="min-h-11 py-3 text-sm underline">
          {ru.workout.programs}
        </Link>
        <Link to="/exercises" className="min-h-11 py-3 text-sm underline">
          {ru.workout.library}
        </Link>
      </div>
    </main>
  );
}

function StartWorkout({ day, date }: { day: WorkoutDay | undefined; date: string }) {
  const start = useStartWorkout(date);

  return (
    <section className="flex flex-col gap-3">
      <p className="text-sm text-slate-500">{ru.workout.none}</p>

      {day?.programs.map((program) => (
        <button
          key={program.id}
          type="button"
          disabled={start.isPending}
          onClick={() => start.mutate(program.id)}
          className="flex min-h-11 flex-col items-start rounded border border-slate-300 p-3 text-left disabled:opacity-50"
        >
          <span className="font-medium">
            {ru.workout.start} · {program.name}
          </span>
          <span className="text-xs text-slate-500">
            {program.items.map((item) => item.exercise.name).join(', ')}
          </span>
        </button>
      ))}

      <button
        type="button"
        disabled={start.isPending}
        onClick={() => start.mutate(null)}
        className="min-h-11 rounded border border-slate-300 disabled:opacity-50"
      >
        {ru.workout.startFree}
      </button>
    </section>
  );
}

function ActiveWorkout({ day, workout }: { day: WorkoutDay; workout: WorkoutInfo }) {
  const remove = useDeleteWorkout();
  const [adding, setAdding] = useState(false);

  return (
    <>
      <section className="flex flex-col gap-2 rounded border border-slate-200 p-3">
        <div className="flex items-baseline justify-between">
          <h2 className="font-medium">{workout.programName ?? ru.workout.startFree}</h2>
          <span className="text-sm tabular-nums text-slate-600">
            {workout.doneSets} / {workout.totalSets}
          </span>
        </div>
        <p className="text-sm text-slate-500">
          {ru.workout.volume}: <span className="tabular-nums">{workout.volume}</span> {ru.workout.kg}
        </p>
      </section>

      {workout.exercises.map((entry) => (
        <ExerciseCard key={entry.exercise.id} workoutId={workout.id} entry={entry} />
      ))}

      {adding ? (
        <ExercisePicker
          workoutId={workout.id}
          used={new Set(workout.exercises.map((e) => e.exercise.id))}
          onClose={() => setAdding(false)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="min-h-11 rounded border border-slate-300"
        >
          {ru.workout.addExercise}
        </button>
      )}

      <StepsRow day={day} />

      <button
        type="button"
        onClick={() => {
          if (window.confirm(ru.workout.deleteConfirm)) remove.mutate(workout.id);
        }}
        disabled={remove.isPending}
        className="min-h-11 rounded border border-red-300 text-sm text-red-700 disabled:opacity-50"
      >
        {ru.workout.deleteWorkout}
      </button>
    </>
  );
}

function ExerciseCard({ workoutId, entry }: { workoutId: string; entry: WorkoutExercise }) {
  const addSet = useAddSet(workoutId);
  const isBodyweight =
    entry.exercise.equipment === 'BODYWEIGHT' || entry.exercise.equipment === 'CARDIO';

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <h3 className="font-medium">{entry.exercise.name}</h3>
        {entry.targetSets !== null && (
          <span className="text-xs text-slate-500">
            {ru.workout.target}: {entry.targetSets}×{entry.targetReps ?? ru.common.dash}
          </span>
        )}
      </div>

      <ul className="flex flex-col gap-1">
        {entry.sets.map((set) => (
          <SetRow
            key={set.id}
            set={set}
            equipment={entry.exercise.equipment}
            isBodyweight={isBodyweight}
          />
        ))}
      </ul>

      <button
        type="button"
        onClick={() => addSet.mutate(entry.exercise.id)}
        disabled={addSet.isPending}
        className="min-h-11 self-start rounded border border-slate-300 px-4 text-sm disabled:opacity-50"
      >
        {ru.workout.addSet}
      </button>
    </section>
  );
}

function ExercisePicker({
  workoutId,
  used,
  onClose,
}: {
  workoutId: string;
  used: Set<string>;
  onClose: () => void;
}) {
  const { data: exercises } = useExercises();
  const addSet = useAddSet(workoutId);
  const [query, setQuery] = useState('');

  const filtered = (exercises ?? []).filter(
    (exercise) =>
      !used.has(exercise.id) && exercise.name.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
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
        {filtered.map((exercise) => (
          <li key={exercise.id}>
            <button
              type="button"
              disabled={addSet.isPending}
              onClick={() => addSet.mutate(exercise.id, { onSuccess: onClose })}
              className="flex min-h-11 w-full flex-col items-start py-2 text-left disabled:opacity-50"
            >
              <span>{exercise.name}</span>
              <span className="text-xs text-slate-500">
                {ru.workout.group[exercise.muscleGroup]} · {ru.workout.gear[exercise.equipment]}
              </span>
            </button>
          </li>
        ))}
      </ul>

      <button type="button" onClick={onClose} className="min-h-11 rounded border px-4 text-sm">
        {ru.common.cancel}
      </button>
    </section>
  );
}

function StepsRow({ day }: { day: WorkoutDay }) {
  return (
    <p className="text-sm text-slate-500">
      {ru.workout.steps}: <span className="tabular-nums">{day.steps ?? ru.common.dash}</span> ({ru.workout.stepsTarget}{' '}
      {day.stepsTarget})
    </p>
  );
}
