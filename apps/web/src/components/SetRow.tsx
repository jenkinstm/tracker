import type { Equipment, WorkoutSetInfo } from '@tracker/shared';
import { stepReps, stepWeight, weightStep } from '@tracker/shared';
import { useState } from 'react';

import { ru } from '../i18n/ru.js';
import { useDeleteSet, useUpdateSet } from '../lib/workout.js';

/**
 * Подход (FR-5.3, FR-5.4).
 *
 * Тап по строке отмечает подход выполненным с уже подставленными числами —
 * это основной и единственный жест, нужный при повторении прошлой тренировки.
 * Стрелки ± и раскрывающийся ручной ввод нужны, только если вес изменился.
 */
export function SetRow({
  set,
  equipment,
  isBodyweight,
}: {
  set: WorkoutSetInfo;
  equipment: Equipment;
  isBodyweight: boolean;
}) {
  const update = useUpdateSet();
  const remove = useDeleteSet();
  const [expanded, setExpanded] = useState(false);

  const step = weightStep(equipment);

  function toggleDone() {
    update.mutate({ id: set.id, done: !set.done });
  }

  function bumpWeight(direction: 1 | -1) {
    update.mutate({ id: set.id, weightKg: stepWeight(set.weightKg, direction, step) });
  }

  function bumpReps(direction: 1 | -1) {
    update.mutate({ id: set.id, reps: stepReps(set.reps, direction) });
  }

  return (
    <li className={`rounded border ${set.done ? 'border-green-300 bg-green-50' : 'border-slate-200'}`}>
      <div className="flex items-stretch">
        {/* Тап по всей строке — отметка. Цель заведомо шире 44 px. */}
        <button
          type="button"
          onClick={toggleDone}
          disabled={update.isPending}
          aria-pressed={set.done}
          className="flex min-h-11 flex-1 items-center gap-3 px-3 text-left disabled:opacity-60"
        >
          <span className="w-5 shrink-0 text-sm text-slate-400 tabular-nums">{set.setIndex}</span>

          <span className="flex-1 tabular-nums">
            {isBodyweight || set.weightKg === null ? (
              <span className="text-slate-500">{ru.workout.bodyweight}</span>
            ) : (
              <>
                {set.weightKg} <span className="text-sm text-slate-500">{ru.workout.kg}</span>
              </>
            )}
            <span className="mx-2 text-slate-300">×</span>
            {set.reps ?? ru.common.dash}{' '}
            <span className="text-sm text-slate-500">{ru.workout.reps}</span>
          </span>

          <span className={`shrink-0 text-lg ${set.done ? 'text-green-700' : 'text-slate-300'}`}>
            {set.done ? '✓' : '○'}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          aria-label={ru.workout.more}
          aria-expanded={expanded}
          className="min-h-11 w-11 shrink-0 border-l border-slate-200 text-slate-400"
        >
          {expanded ? '▴' : '▾'}
        </button>
      </div>

      {expanded && (
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 p-2">
          {!isBodyweight && (
            <Stepper
              label={ru.workout.kg}
              value={set.weightKg}
              onStep={bumpWeight}
              disabled={update.isPending}
            />
          )}
          <Stepper
            label={ru.workout.reps}
            value={set.reps}
            onStep={bumpReps}
            disabled={update.isPending}
          />

          <button
            type="button"
            onClick={() => remove.mutate(set.id)}
            disabled={remove.isPending}
            className="ml-auto min-h-11 px-3 text-sm text-red-700 disabled:opacity-50"
          >
            {ru.workout.deleteSet}
          </button>
        </div>
      )}
    </li>
  );
}

/** Стрелки ± вместо ручного ввода — требование FR-5.4. */
function Stepper({
  label,
  value,
  onStep,
  disabled,
}: {
  label: string;
  value: number | null;
  onStep: (direction: 1 | -1) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        aria-label={`${label} ${ru.workout.less}`}
        onClick={() => onStep(-1)}
        disabled={disabled}
        className="min-h-11 w-11 rounded border border-slate-300 text-lg disabled:opacity-50"
      >
        −
      </button>
      <span className="w-14 text-center tabular-nums">
        {value ?? ru.common.dash}
        <span className="block text-xs text-slate-500">{label}</span>
      </span>
      <button
        type="button"
        aria-label={`${label} ${ru.workout.more}`}
        onClick={() => onStep(1)}
        disabled={disabled}
        className="min-h-11 w-11 rounded border border-slate-300 text-lg disabled:opacity-50"
      >
        +
      </button>
    </div>
  );
}
