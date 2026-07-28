import type { ActivityLevel, DeficitMode, ProfileResponse, ProfileUpdate } from '@tracker/shared';
import { type FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';

import { Section, SelectField, TextField, TimeField } from '../components/fields.js';
import { ru } from '../i18n/ru.js';
import { useProfile, useUpdateProfile } from '../lib/profile.js';

/**
 * Числа в форме живут строками, разбираются один раз при отправке.
 * Ключи перечислены явно, а не `Record<string, string>`: так опечатка в имени
 * поля становится ошибкой типов, а не пустым инпутом.
 */
type DraftKey =
  | 'sex'
  | 'birthYear'
  | 'heightCm'
  | 'activityLevel'
  | 'startWeight'
  | 'goalWeight'
  | 'deficitMode'
  | 'deficitValue'
  | 'proteinPerKg'
  | 'fatPerKg'
  | 'kcalTarget'
  | 'proteinTarget'
  | 'fatTarget'
  | 'carbTarget'
  | 'sweetsBudget'
  | 'windowStart'
  | 'windowEnd'
  | 'stepsTarget'
  | 'waterTarget';

type Draft = Record<DraftKey, string>;

function toDraft(p: ProfileResponse['profile']): Draft {
  const text = (value: number | null) => (value === null ? '' : String(value));

  return {
    sex: p.sex ?? '',
    birthYear: text(p.birthYear),
    heightCm: text(p.heightCm),
    activityLevel: p.activityLevel,
    startWeight: text(p.startWeight),
    goalWeight: text(p.goalWeight),
    deficitMode: p.deficitMode,
    deficitValue: text(p.deficitValue),
    proteinPerKg: text(p.proteinPerKg),
    fatPerKg: text(p.fatPerKg),
    kcalTarget: text(p.kcalTarget),
    proteinTarget: text(p.proteinTarget),
    fatTarget: text(p.fatTarget),
    carbTarget: text(p.carbTarget),
    sweetsBudget: text(p.sweetsBudget),
    windowStart: p.windowStart,
    windowEnd: p.windowEnd,
    stepsTarget: text(p.stepsTarget),
    waterTarget: text(p.waterTarget),
  };
}

/** Пустое поле — это «считай по формуле» (FR-1.3), а не ноль. */
function num(raw: string): number | null {
  const normalized = raw.replace(',', '.').trim();
  if (normalized === '') return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

function toUpdate(draft: Draft): ProfileUpdate {
  return {
    sex: draft.sex === '' ? null : (draft.sex as 'MALE' | 'FEMALE'),
    birthYear: num(draft.birthYear),
    heightCm: num(draft.heightCm),
    activityLevel: draft.activityLevel as ActivityLevel,
    startWeight: num(draft.startWeight),
    goalWeight: num(draft.goalWeight),
    deficitMode: draft.deficitMode as DeficitMode,
    deficitValue: num(draft.deficitValue) ?? 0,
    proteinPerKg: num(draft.proteinPerKg),
    fatPerKg: num(draft.fatPerKg),
    kcalTarget: num(draft.kcalTarget),
    proteinTarget: num(draft.proteinTarget),
    fatTarget: num(draft.fatTarget),
    carbTarget: num(draft.carbTarget),
    sweetsBudget: num(draft.sweetsBudget),
    windowStart: draft.windowStart,
    windowEnd: draft.windowEnd,
    stepsTarget: num(draft.stepsTarget) ?? 0,
    waterTarget: num(draft.waterTarget) ?? 0,
  };
}

const ACTIVITY_OPTIONS = (['SEDENTARY', 'LIGHT', 'MODERATE', 'HIGH', 'ATHLETE'] as const).map(
  (value) => ({ value, label: ru.profile.activity[value] }),
);

const SEX_OPTIONS = [
  { value: '', label: ru.profile.sexEmpty },
  { value: 'MALE', label: ru.profile.sexMale },
  { value: 'FEMALE', label: ru.profile.sexFemale },
] as const;

const DEFICIT_OPTIONS = [
  { value: 'PERCENT', label: ru.profile.deficitPercent },
  { value: 'KCAL', label: ru.profile.deficitKcal },
] as const;

function computedHint(value: number | null): string {
  return value === null ? ru.profile.autoPlaceholder : `${ru.profile.computedHint}: ${value}`;
}

export function ProfilePage() {
  const { data, isPending, isError } = useProfile();
  const update = useUpdateProfile();
  const [draft, setDraft] = useState<Draft | null>(null);

  if (isPending) return <p className="p-4">{ru.common.loading}</p>;
  if (isError || !data) return <p className="p-4">{ru.login.networkError}</p>;

  const current = draft ?? toDraft(data.profile);
  const set = (key: DraftKey) => (value: string) => setDraft({ ...current, [key]: value });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    update.mutate(toUpdate(current), { onSuccess: () => setDraft(null) });
  }

  const { computed, missing, weight } = data;

  return (
    <main className="mx-auto flex max-w-md flex-col gap-6 p-4 pb-24">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{ru.profile.heading}</h1>
        <Link to="/" className="min-h-11 py-3 text-sm underline">
          {ru.profile.back}
        </Link>
      </header>

      <Summary computed={computed} missing={missing} weight={weight} />

      <form onSubmit={onSubmit} className="flex flex-col gap-6">
        <Section title={ru.profile.sectionBody}>
          <SelectField
            id="sex"
            label={ru.profile.sex}
            value={current.sex}
            options={SEX_OPTIONS}
            onChange={set('sex')}
          />
          <TextField
            id="birthYear"
            label={ru.profile.birthYear}
            value={current.birthYear}
            onChange={set('birthYear')}
            numeric="integer"
          />
          <TextField
            id="heightCm"
            label={ru.profile.heightCm}
            value={current.heightCm}
            onChange={set('heightCm')}
            numeric="integer"
          />
          <SelectField
            id="activityLevel"
            label={ru.profile.activityLevel}
            value={current.activityLevel as ActivityLevel}
            options={ACTIVITY_OPTIONS}
            onChange={set('activityLevel')}
          />
        </Section>

        <Section title={ru.profile.sectionGoal}>
          <TextField
            id="startWeight"
            label={ru.profile.startWeight}
            value={current.startWeight}
            onChange={set('startWeight')}
            numeric="decimal"
          />
          <TextField
            id="goalWeight"
            label={ru.profile.goalWeight}
            value={current.goalWeight}
            onChange={set('goalWeight')}
            numeric="decimal"
          />
          <div className="grid grid-cols-2 gap-3">
            <TextField
              id="deficitValue"
              label={ru.profile.deficit}
              value={current.deficitValue}
              onChange={set('deficitValue')}
              numeric="decimal"
            />
            <SelectField
              id="deficitMode"
              label=" "
              value={current.deficitMode as DeficitMode}
              options={DEFICIT_OPTIONS}
              onChange={set('deficitMode')}
            />
          </div>
        </Section>

        <Section title={ru.profile.sectionTargets}>
          <TextField
            id="kcalTarget"
            label={ru.profile.kcalTarget}
            value={current.kcalTarget}
            onChange={set('kcalTarget')}
            numeric="integer"
            placeholder={ru.profile.autoPlaceholder}
            hint={computedHint(computed.kcal)}
          />
          <TextField
            id="proteinTarget"
            label={ru.profile.proteinTarget}
            value={current.proteinTarget}
            onChange={set('proteinTarget')}
            numeric="integer"
            placeholder={ru.profile.autoPlaceholder}
            hint={computedHint(computed.protein)}
          />
          <TextField
            id="fatTarget"
            label={ru.profile.fatTarget}
            value={current.fatTarget}
            onChange={set('fatTarget')}
            numeric="integer"
            placeholder={ru.profile.autoPlaceholder}
            hint={computedHint(computed.fat)}
          />
          <TextField
            id="carbTarget"
            label={ru.profile.carbTarget}
            value={current.carbTarget}
            onChange={set('carbTarget')}
            numeric="integer"
            placeholder={ru.profile.autoPlaceholder}
            hint={computedHint(computed.carb)}
          />
          <TextField
            id="sweetsBudget"
            label={ru.profile.sweetsBudget}
            value={current.sweetsBudget}
            onChange={set('sweetsBudget')}
            numeric="integer"
            placeholder={ru.profile.autoPlaceholder}
            hint={computedHint(computed.sweets)}
          />
          <div className="grid grid-cols-2 gap-3">
            <TextField
              id="proteinPerKg"
              label={ru.profile.proteinPerKg}
              value={current.proteinPerKg}
              onChange={set('proteinPerKg')}
              numeric="decimal"
              placeholder="1,8"
            />
            <TextField
              id="fatPerKg"
              label={ru.profile.fatPerKg}
              value={current.fatPerKg}
              onChange={set('fatPerKg')}
              numeric="decimal"
              placeholder="0,9"
            />
          </div>
        </Section>

        <Section title={ru.profile.sectionDay}>
          <div className="grid grid-cols-2 gap-3">
            <TimeField
              id="windowStart"
              label={ru.profile.windowStart}
              value={current.windowStart}
              onChange={set('windowStart')}
            />
            <TimeField
              id="windowEnd"
              label={ru.profile.windowEnd}
              value={current.windowEnd}
              onChange={set('windowEnd')}
            />
          </div>
          <TextField
            id="stepsTarget"
            label={ru.profile.stepsTarget}
            value={current.stepsTarget}
            onChange={set('stepsTarget')}
            numeric="integer"
          />
          <TextField
            id="waterTarget"
            label={ru.profile.waterTarget}
            value={current.waterTarget}
            onChange={set('waterTarget')}
            numeric="integer"
          />
        </Section>

        <div className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white p-4">
          <div className="mx-auto flex max-w-md items-center gap-3">
            <button
              type="submit"
              disabled={update.isPending}
              className="min-h-11 flex-1 rounded bg-slate-800 text-white disabled:opacity-50"
            >
              {update.isPending ? ru.profile.saving : ru.profile.save}
            </button>
            {update.isSuccess && draft === null && (
              <span className="text-sm text-green-700">{ru.profile.saved}</span>
            )}
            {update.isError && (
              <span role="alert" className="text-sm text-red-700">
                {ru.profile.saveError}
              </span>
            )}
          </div>
        </div>
      </form>
    </main>
  );
}

function Summary({
  computed,
  missing,
  weight,
}: Pick<ProfileResponse, 'computed' | 'missing' | 'weight'>) {
  const weightNote =
    weight.source === 'MEASURED'
      ? ru.profile.weightMeasured
      : weight.source === 'START'
        ? ru.profile.weightStart
        : ru.profile.weightNone;

  return (
    <section className="flex flex-col gap-2 rounded border border-slate-200 p-3">
      <dl className="grid grid-cols-3 gap-2 text-center">
        <Stat label={ru.profile.age} value={computed.ageYears} unit={ru.profile.ageYears} />
        <Stat label={ru.profile.bmr} value={computed.bmr} unit="ккал" />
        <Stat label={ru.profile.tdee} value={computed.tdee} unit="ккал" />
      </dl>

      <p className="text-xs text-slate-500">{weightNote}</p>

      {missing.length > 0 && (
        <p className="text-sm text-amber-700">
          {ru.profile.missingHeading} {missing.map((field) => ru.profile.missing[field]).join(', ')}
        </p>
      )}
    </section>
  );
}

function Stat({ label, value, unit }: { label: string; value: number | null; unit: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums">
        {value === null ? ru.common.dash : value}
        {value !== null && <span className="ml-1 text-xs font-normal text-slate-500">{unit}</span>}
      </dd>
    </div>
  );
}
