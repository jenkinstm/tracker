import type { WeightStats } from '@tracker/shared';
import { todayIso } from '@tracker/shared';
import { useState } from 'react';

import { ru } from '../i18n/ru.js';
import { useSaveWeight } from '../lib/weight.js';

/**
 * Запись веса с главного экрана за два тапа (критерий приёмки №2).
 *
 * Тап первый — «Записать вес», раскрывается поле с уже подставленным
 * прошлым значением. Тап второй — «Сохранить». Клавиатура нужна, только
 * если вес изменился не на то, что подставлено.
 */
export function QuickWeight({ stats }: { stats: WeightStats | undefined }) {
  const [open, setOpen] = useState(false);
  const save = useSaveWeight();

  const prefill = stats?.latest?.kg ?? stats?.startWeight ?? null;
  const [value, setValue] = useState('');

  const today = todayIso();
  const alreadyToday = stats?.latest?.date === today;

  function start() {
    setValue(prefill === null ? '' : String(prefill));
    setOpen(true);
  }

  function submit() {
    const kg = Number(value.replace(',', '.').trim());
    if (!Number.isFinite(kg) || kg <= 0) return;

    save.mutate({ date: today, kg }, { onSuccess: () => setOpen(false) });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={start}
        className="min-h-11 rounded border border-slate-300 px-4 text-sm"
      >
        {ru.weight.record}
        {alreadyToday && stats?.latest ? ` · ${stats.latest.kg} ${ru.weight.kg}` : ''}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded border border-slate-300 p-3">
      <div className="flex gap-2">
        <input
          aria-label={`${ru.weight.heading}, ${ru.weight.kg}`}
          type="text"
          inputMode="decimal"
          value={value}
          autoFocus
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && submit()}
          className="min-h-11 w-28 rounded border border-slate-300 px-3 text-base"
        />
        <span className="self-center text-sm text-slate-500">{ru.weight.kg}</span>

        <button
          type="button"
          onClick={submit}
          disabled={save.isPending}
          className="min-h-11 flex-1 rounded bg-slate-800 text-white disabled:opacity-50"
        >
          {save.isPending ? ru.weight.saving : ru.weight.save}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="min-h-11 rounded border px-3 text-sm"
        >
          {ru.common.cancel}
        </button>
      </div>

      {save.isError && (
        <p role="alert" className="text-sm text-red-700">
          {ru.weight.saveError}
        </p>
      )}
    </div>
  );
}
