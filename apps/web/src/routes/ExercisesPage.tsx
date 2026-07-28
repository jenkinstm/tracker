import type { Equipment, MuscleGroup } from '@tracker/shared';
import { type FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';

import { SelectField, TextField } from '../components/fields.js';
import { ru } from '../i18n/ru.js';
import { useCreateExercise, useExercises } from '../lib/workout.js';

const GROUPS = Object.keys(ru.workout.group) as MuscleGroup[];
const GEAR = Object.keys(ru.workout.gear) as Equipment[];

const GROUP_OPTIONS = GROUPS.map((value) => ({ value, label: ru.workout.group[value] }));
const GEAR_OPTIONS = GEAR.map((value) => ({ value, label: ru.workout.gear[value] }));

/** Библиотека упражнений и создание своих (FR-5.1). */
export function ExercisesPage() {
  const { data: exercises, isPending } = useExercises();
  const [group, setGroup] = useState<MuscleGroup | ''>('');
  const [creating, setCreating] = useState(false);

  const filtered = (exercises ?? []).filter((e) => group === '' || e.muscleGroup === group);

  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 p-4">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{ru.workout.library}</h1>
        <Link to="/workout" className="min-h-11 py-3 text-sm underline">
          {ru.common.back}
        </Link>
      </header>

      <SelectField
        id="group"
        label={ru.workout.muscleGroup}
        value={group}
        options={[{ value: '' as const, label: ru.workout.allGroups }, ...GROUP_OPTIONS]}
        onChange={(value) => setGroup(value as MuscleGroup | '')}
      />

      {creating ? (
        <NewExerciseForm onDone={() => setCreating(false)} />
      ) : (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="min-h-11 rounded border border-slate-300"
        >
          {ru.workout.ownExercise}
        </button>
      )}

      {isPending ? (
        <p className="text-sm text-slate-500">{ru.common.loading}</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {filtered.map((exercise) => (
            <li key={exercise.id} className="flex min-h-11 items-center gap-2 py-2">
              <span className="flex-1">
                <span className="flex items-center gap-2">
                  {exercise.name}
                  {exercise.isOwn && (
                    <span className="rounded bg-slate-100 px-1 text-xs text-slate-600">
                      {ru.diary.ownBadge}
                    </span>
                  )}
                </span>
                <span className="block text-xs text-slate-500">
                  {ru.workout.group[exercise.muscleGroup]} · {ru.workout.gear[exercise.equipment]} ·{' '}
                  {exercise.restSec} с
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function NewExerciseForm({ onDone }: { onDone: () => void }) {
  const create = useCreateExercise();
  const [name, setName] = useState('');
  const [muscleGroup, setMuscleGroup] = useState<MuscleGroup>('FULL_BODY');
  const [equipment, setEquipment] = useState<Equipment>('DUMBBELL');
  const [restSec, setRestSec] = useState('90');

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const rest = Number(restSec.replace(',', '.').trim());

    create.mutate(
      {
        name: name.trim(),
        muscleGroup,
        equipment,
        isCardio: equipment === 'CARDIO',
        restSec: Number.isFinite(rest) ? Math.round(rest) : 90,
      },
      { onSuccess: onDone },
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 rounded border border-slate-300 p-3">
      <TextField id="name" label={ru.workout.exerciseName} value={name} onChange={setName} />
      <SelectField
        id="muscleGroup"
        label={ru.workout.muscleGroup}
        value={muscleGroup}
        options={GROUP_OPTIONS}
        onChange={setMuscleGroup}
      />
      <SelectField
        id="equipment"
        label={ru.workout.equipment}
        value={equipment}
        options={GEAR_OPTIONS}
        onChange={setEquipment}
      />
      <TextField
        id="restSec"
        label={ru.workout.restSec}
        value={restSec}
        onChange={setRestSec}
        numeric="integer"
      />

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={create.isPending || name.trim().length < 2}
          className="min-h-11 flex-1 rounded bg-slate-800 text-white disabled:opacity-50"
        >
          {create.isPending ? ru.workout.saving : ru.workout.create}
        </button>
        <button type="button" onClick={onDone} className="min-h-11 rounded border px-4">
          {ru.common.cancel}
        </button>
      </div>

      {create.isError && (
        <p role="alert" className="text-sm text-red-700">
          {ru.workout.saveError}
        </p>
      )}
    </form>
  );
}
