import type { AmountUnit, FoodInfo, RecentFood } from '@tracker/shared';
import { amountToGrams, todayIso } from '@tracker/shared';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { ru } from '../i18n/ru.js';
import { useAddEntry, useFoodSearch, useRecentFoods } from '../lib/diary.js';

/**
 * Экран добавления. Открывается сразу со списком «недавних» (FR-2.6):
 * тап по строке добавляет продукт прошлым весом и возвращает на главный.
 * Вместе с кнопкой «Добавить еду» это два тапа — критерий приёмки №1.
 */
export function AddEntryPage() {
  const navigate = useNavigate();
  const [date] = useState(() => todayIso());
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<'recent' | 'frequent'>('recent');
  const [chosen, setChosen] = useState<FoodInfo | null>(null);

  const recent = useRecentFoods();
  const search = useFoodSearch(query);
  const add = useAddEntry();

  const isSearching = query.trim().length > 0;

  function addNow(foodId: string, grams: number) {
    add.mutate({ date, foodId, grams }, { onSuccess: () => navigate('/') });
  }

  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 p-4">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{ru.diary.addShort}</h1>
        <Link to="/" className="min-h-11 py-3 text-sm underline">
          {ru.common.cancel}
        </Link>
      </header>

      <div className="flex flex-col gap-1">
        <label htmlFor="q" className="text-sm text-slate-600">
          {ru.diary.searchLabel}
        </label>
        <input
          id="q"
          type="search"
          value={query}
          placeholder={ru.diary.searchPlaceholder}
          // Автодополнение мешает поиску продуктов (NFR-3).
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          onChange={(event) => {
            setQuery(event.target.value);
            setChosen(null);
          }}
          className="min-h-11 rounded border border-slate-300 px-3 text-base focus:border-slate-500 focus:outline-none"
        />
      </div>

      {chosen && (
        <AmountPanel
          food={chosen}
          pending={add.isPending}
          onCancel={() => setChosen(null)}
          onSubmit={(grams) => addNow(chosen.id, grams)}
        />
      )}

      {isSearching ? (
        <SearchResults
          foods={search.data}
          loading={search.isFetching}
          onPick={setChosen}
          picked={chosen?.id}
        />
      ) : (
        <RecentList
          tab={tab}
          onTab={setTab}
          data={recent.data}
          loading={recent.isPending}
          pending={add.isPending}
          onQuickAdd={addNow}
          onPick={setChosen}
        />
      )}

      {add.isError && (
        <p role="alert" className="text-sm text-red-700">
          {ru.diary.saveError}
        </p>
      )}

      <Link to="/foods/new" className="min-h-11 py-3 text-sm underline">
        {ru.diary.newFood}
      </Link>
    </main>
  );
}

function SearchResults({
  foods,
  loading,
  onPick,
  picked,
}: {
  foods: FoodInfo[] | undefined;
  loading: boolean;
  onPick: (food: FoodInfo) => void;
  picked: string | undefined;
}) {
  if (loading && !foods) return <p className="text-sm text-slate-500">{ru.diary.searching}</p>;
  if (foods && foods.length === 0) return <p className="text-sm text-slate-500">{ru.diary.searchEmpty}</p>;

  return (
    <ul className="divide-y divide-slate-100">
      {foods?.map((food) => (
        <li key={food.id}>
          <button
            type="button"
            onClick={() => onPick(food)}
            aria-pressed={picked === food.id}
            className={`flex min-h-11 w-full flex-col items-start py-2 text-left ${
              picked === food.id ? 'opacity-50' : ''
            }`}
          >
            <FoodLine food={food} />
          </button>
        </li>
      ))}
    </ul>
  );
}

function RecentList({
  tab,
  onTab,
  data,
  loading,
  pending,
  onQuickAdd,
  onPick,
}: {
  tab: 'recent' | 'frequent';
  onTab: (tab: 'recent' | 'frequent') => void;
  data: { recent: RecentFood[]; frequent: RecentFood[] } | undefined;
  loading: boolean;
  pending: boolean;
  onQuickAdd: (foodId: string, grams: number) => void;
  onPick: (food: FoodInfo) => void;
}) {
  if (loading) return <p className="text-sm text-slate-500">{ru.common.loading}</p>;

  const items = data?.[tab] ?? [];

  return (
    <section className="flex flex-col gap-2">
      <div className="flex gap-2">
        {(['recent', 'frequent'] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => onTab(key)}
            className={`min-h-11 rounded px-3 text-sm ${
              tab === key ? 'bg-slate-800 text-white' : 'border border-slate-300'
            }`}
          >
            {key === 'recent' ? ru.diary.recent : ru.diary.frequent}
          </button>
        ))}
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-slate-500">{ru.diary.recentEmpty}</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.map((food) => (
            <li key={food.id} className="flex items-stretch gap-2">
              {/* Основной путь: один тап добавляет прошлым весом. */}
              <button
                type="button"
                disabled={pending}
                onClick={() => onQuickAdd(food.id, food.lastGrams)}
                className="flex min-h-11 flex-1 flex-col items-start py-2 text-left disabled:opacity-50"
              >
                <FoodLine food={food} />
                <span className="text-xs text-slate-500">
                  {food.lastGrams} г {ru.diary.lastTime}
                </span>
              </button>

              {/* Запасной: открыть количество, если сегодня порция другая. */}
              <button
                type="button"
                onClick={() => onPick(food)}
                aria-label={ru.diary.amount}
                className="min-h-11 w-11 shrink-0 rounded border border-slate-300 text-slate-600"
              >
                г
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function FoodLine({ food }: { food: FoodInfo }) {
  return (
    <>
      <span className="flex items-center gap-2">
        <span>{food.name}</span>
        {food.isOwn && (
          <span className="rounded bg-slate-100 px-1 text-xs text-slate-600">
            {ru.diary.ownBadge}
          </span>
        )}
      </span>
      <span className="text-xs text-slate-500">
        {food.kcal100} ккал · Б {food.protein100} · Ж {food.fat100} · У {food.carb100}{' '}
        {ru.diary.per100}
      </span>
    </>
  );
}

/** Количество в граммах, штуках или порциях (FR-2.2). */
function AmountPanel({
  food,
  pending,
  onCancel,
  onSubmit,
}: {
  food: FoodInfo;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (grams: number) => void;
}) {
  const units = buildUnits(food);
  const [unitIndex, setUnitIndex] = useState(0);
  const [amount, setAmount] = useState(() => String(units[0]?.defaultAmount ?? 100));

  const unit = units[unitIndex]!;
  const parsed = Number(amount.replace(',', '.'));
  const grams = amountToGrams(Number.isFinite(parsed) ? parsed : Number.NaN, unit.unit);

  return (
    <section className="flex flex-col gap-2 rounded border border-slate-300 p-3">
      <p className="font-medium">{food.name}</p>

      <div className="flex gap-2">
        <input
          aria-label={ru.diary.amount}
          type="text"
          inputMode="decimal"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          className="min-h-11 w-24 rounded border border-slate-300 px-3 text-base"
        />
        <select
          aria-label={ru.diary.amount}
          value={unitIndex}
          onChange={(event) => {
            const next = Number(event.target.value);
            setUnitIndex(next);
            setAmount(String(units[next]?.defaultAmount ?? 100));
          }}
          className="min-h-11 flex-1 rounded border border-slate-300 px-3 text-base"
        >
          {units.map((option, index) => (
            <option key={option.label} value={index}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <p className="text-sm text-slate-600 tabular-nums">
        {grams === null ? ru.common.dash : `${grams} г · ${Math.round((food.kcal100 * grams) / 100)} ккал`}
      </p>

      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending || grams === null}
          onClick={() => grams !== null && onSubmit(grams)}
          className="min-h-11 flex-1 rounded bg-slate-800 text-white disabled:opacity-50"
        >
          {pending ? ru.diary.saving : ru.diary.save}
        </button>
        <button type="button" onClick={onCancel} className="min-h-11 rounded border px-4">
          {ru.common.cancel}
        </button>
      </div>
    </section>
  );
}

type UnitOption = { label: string; unit: AmountUnit; defaultAmount: number };

function buildUnits(food: FoodInfo): UnitOption[] {
  const options: UnitOption[] = [
    {
      label: ru.diary.unitGrams,
      unit: { kind: 'GRAMS' },
      defaultAmount: food.defaultPortionG ?? 100,
    },
  ];

  if (food.defaultPortionG) {
    options.push({
      label: `${ru.diary.unitPortion} (${food.defaultPortionG} г)`,
      unit: { kind: 'PORTION', gramsPerPortion: food.defaultPortionG },
      defaultAmount: 1,
    });
  }

  for (const unit of food.units) {
    options.push({
      label: `${unit.unitName} (${unit.grams} г)`,
      unit: { kind: 'PIECE', gramsPerUnit: unit.grams },
      defaultAmount: 1,
    });
  }

  return options;
}
