import { type FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { TextField } from '../components/fields.js';
import { ru } from '../i18n/ru.js';
import { useCreateFood } from '../lib/diary.js';

type Draft = {
  name: string;
  brand: string;
  kcal100: string;
  protein100: string;
  fat100: string;
  carb100: string;
  defaultPortionG: string;
};

const EMPTY: Draft = {
  name: '',
  brand: '',
  kcal100: '',
  protein100: '',
  fat100: '',
  carb100: '',
  defaultPortionG: '',
};

function num(raw: string): number {
  const value = Number(raw.replace(',', '.').trim());
  return Number.isFinite(value) ? value : 0;
}

/** Свой продукт (FR-2.5): попадает в личную базу и участвует в поиске. */
export function NewFoodPage() {
  const navigate = useNavigate();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [isSweet, setIsSweet] = useState(false);
  const create = useCreateFood();

  const set = (key: keyof Draft) => (value: string) => setDraft({ ...draft, [key]: value });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const portion = draft.defaultPortionG.trim();

    create.mutate(
      {
        name: draft.name.trim(),
        brand: draft.brand.trim() === '' ? null : draft.brand.trim(),
        kcal100: num(draft.kcal100),
        protein100: num(draft.protein100),
        fat100: num(draft.fat100),
        carb100: num(draft.carb100),
        defaultPortionG: portion === '' ? null : num(portion),
        isSweet,
      },
      { onSuccess: () => navigate('/add') },
    );
  }

  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 p-4">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{ru.diary.newFood}</h1>
        <Link to="/add" className="min-h-11 py-3 text-sm underline">
          {ru.common.cancel}
        </Link>
      </header>

      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <TextField id="name" label={ru.diary.newFoodName} value={draft.name} onChange={set('name')} />
        <TextField
          id="brand"
          label={ru.diary.newFoodBrand}
          value={draft.brand}
          onChange={set('brand')}
        />

        <p className="text-xs text-slate-500">
          КБЖУ указывай на 100 г готового продукта — так же, как в основной базе.
        </p>

        <TextField
          id="kcal100"
          label={ru.diary.newFoodKcal}
          value={draft.kcal100}
          onChange={set('kcal100')}
          numeric="decimal"
        />
        <div className="grid grid-cols-3 gap-3">
          <TextField
            id="protein100"
            label={ru.diary.newFoodProtein}
            value={draft.protein100}
            onChange={set('protein100')}
            numeric="decimal"
          />
          <TextField
            id="fat100"
            label={ru.diary.newFoodFat}
            value={draft.fat100}
            onChange={set('fat100')}
            numeric="decimal"
          />
          <TextField
            id="carb100"
            label={ru.diary.newFoodCarb}
            value={draft.carb100}
            onChange={set('carb100')}
            numeric="decimal"
          />
        </div>

        <TextField
          id="defaultPortionG"
          label={ru.diary.newFoodPortion}
          value={draft.defaultPortionG}
          onChange={set('defaultPortionG')}
          numeric="integer"
        />

        <label className="flex min-h-11 items-center gap-2">
          <input
            type="checkbox"
            checked={isSweet}
            onChange={(event) => setIsSweet(event.target.checked)}
            className="h-5 w-5"
          />
          <span className="text-sm">{ru.diary.newFoodSweet}</span>
        </label>

        <button
          type="submit"
          disabled={create.isPending || draft.name.trim().length < 2}
          className="min-h-11 rounded bg-slate-800 text-white disabled:opacity-50"
        >
          {create.isPending ? ru.diary.saving : ru.diary.newFoodCreate}
        </button>
      </form>

      {create.isError && (
        <p role="alert" className="text-sm text-red-700">
          {ru.diary.saveError}
        </p>
      )}
    </main>
  );
}
