import type { MealType } from '@tracker/shared';
import { todayIso } from '@tracker/shared';
import { type FormEvent, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { SelectField, TextField, TimeField } from '../components/fields.js';
import { ru } from '../i18n/ru.js';
import { useDeleteEntry, useDiaryDay, useUpdateEntry } from '../lib/diary.js';

const MEAL_OPTIONS = [
  { value: '', label: ru.diary.mealAuto },
  { value: 'BREAKFAST', label: ru.diary.meal.BREAKFAST },
  { value: 'LUNCH', label: ru.diary.meal.LUNCH },
  { value: 'DINNER', label: ru.diary.meal.DINNER },
  { value: 'SNACK', label: ru.diary.meal.SNACK },
] as const;

/** Правка и удаление записи (FR-2.4). */
export function EditEntryPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [date] = useState(() => todayIso());

  const { data: day, isPending } = useDiaryDay(date);
  const update = useUpdateEntry();
  const remove = useDeleteEntry();

  const entry = day?.entries.find((item) => item.id === id);

  const [draft, setDraft] = useState<{ grams: string; time: string; mealType: string } | null>(null);

  if (isPending) return <p className="p-4">{ru.common.loading}</p>;
  if (!entry) return <NotFound />;

  const current = draft ?? {
    grams: entry.grams === null ? '' : String(entry.grams),
    time: entry.time,
    mealType: entry.mealType ?? '',
  };
  const set = (key: keyof typeof current) => (value: string) =>
    setDraft({ ...current, [key]: value });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!entry) return;

    const grams = Number(current.grams.replace(',', '.'));

    update.mutate(
      {
        id: entry.id,
        ...(Number.isFinite(grams) ? { grams } : {}),
        time: current.time,
        mealType: current.mealType === '' ? null : (current.mealType as MealType),
      },
      { onSuccess: () => navigate('/') },
    );
  }

  function onDelete() {
    if (!entry) return;
    if (!window.confirm(ru.diary.deleteConfirm)) return;

    remove.mutate(entry.id, { onSuccess: () => navigate('/') });
  }

  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 p-4">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{entry.name}</h1>
        <Link to="/" className="min-h-11 py-3 text-sm underline">
          {ru.common.cancel}
        </Link>
      </header>

      <p className="text-sm text-slate-600">
        {entry.kcal} ккал · Б {entry.protein} · Ж {entry.fat} · У {entry.carb}
      </p>

      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <TextField
          id="grams"
          label={`${ru.diary.amount}, ${ru.diary.unitGrams}`}
          value={current.grams}
          onChange={set('grams')}
          numeric="decimal"
        />
        <TimeField id="time" label={ru.diary.time} value={current.time} onChange={set('time')} />
        <SelectField
          id="mealType"
          label={ru.diary.mealType}
          value={current.mealType}
          options={MEAL_OPTIONS}
          onChange={set('mealType')}
        />

        <button
          type="submit"
          disabled={update.isPending}
          className="min-h-11 rounded bg-slate-800 text-white disabled:opacity-50"
        >
          {update.isPending ? ru.diary.saving : ru.diary.save}
        </button>
      </form>

      <button
        type="button"
        onClick={onDelete}
        disabled={remove.isPending}
        className="min-h-11 rounded border border-red-300 text-red-700 disabled:opacity-50"
      >
        {ru.diary.delete}
      </button>

      {(update.isError || remove.isError) && (
        <p role="alert" className="text-sm text-red-700">
          {ru.diary.saveError}
        </p>
      )}
    </main>
  );
}

function NotFound() {
  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 p-4">
      <p>{ru.diary.empty}</p>
      <Link to="/" className="min-h-11 py-3 text-sm underline">
        {ru.common.back}
      </Link>
    </main>
  );
}
