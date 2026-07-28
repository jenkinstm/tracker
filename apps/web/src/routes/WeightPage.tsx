import type { ChartPeriod, Forecast, TrendPoint, WeightStats } from '@tracker/shared';
import { shiftIsoDate, todayIso } from '@tracker/shared';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import { QuickWeight } from '../components/QuickWeight.js';
import { WeightChart } from '../components/WeightChart.js';
import { ru } from '../i18n/ru.js';
import { useDeleteWeight, useWeightStats } from '../lib/weight.js';

const PERIODS: { value: ChartPeriod; label: string }[] = [
  { value: 30, label: ru.weight.period30 },
  { value: 90, label: ru.weight.period90 },
  { value: 365, label: ru.weight.period365 },
  { value: null, label: ru.weight.periodAll },
];

export function WeightPage() {
  const { data, isPending } = useWeightStats();
  const [period, setPeriod] = useState<ChartPeriod>(90);

  if (isPending) return <p className="p-4">{ru.common.loading}</p>;

  const points = data?.points ?? [];
  const stats = data?.stats;
  const visible = period === null ? points : cutTo(points, period);

  return (
    <main className="mx-auto flex max-w-md flex-col gap-6 p-4">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{ru.weight.heading}</h1>
        <Link to="/" className="min-h-11 py-3 text-sm underline">
          {ru.common.back}
        </Link>
      </header>

      <QuickWeight stats={stats} />

      {stats && <Summary stats={stats} />}

      <section className="flex flex-col gap-2">
        <div className="flex gap-2">
          {PERIODS.map(({ value, label }) => (
            <button
              key={label}
              type="button"
              onClick={() => setPeriod(value)}
              className={`min-h-11 flex-1 rounded px-2 text-sm ${
                period === value ? 'bg-slate-800 text-white' : 'border border-slate-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <WeightChart points={visible} goalWeight={stats?.goalWeight ?? null} />
      </section>

      <History points={points} />
    </main>
  );
}

/**
 * Обрезка для графика делается на клиенте, а тренд приходит посчитанным
 * по всей истории: пересчёт от начала периода дал бы кривую, которая
 * заново разгоняется на левом краю.
 */
function cutTo(points: TrendPoint[], days: number): TrendPoint[] {
  const from = shiftIsoDate(todayIso(), -(days - 1));
  return points.filter((point) => point.date >= from);
}

function Summary({ stats }: { stats: WeightStats }) {
  return (
    <section className="flex flex-col gap-3 rounded border border-slate-200 p-3">
      <div className="text-center">
        <p className="text-xs uppercase tracking-wide text-slate-500">{ru.weight.trend}</p>
        <p className="text-3xl font-semibold tabular-nums">
          {stats.trend === null ? ru.common.dash : stats.trend.toFixed(1)}
          <span className="ml-1 text-sm font-normal text-slate-500">{ru.weight.kg}</span>
        </p>
        {stats.latest && (
          <p className="text-xs text-slate-500">
            {ru.weight.latest}: {stats.latest.kg} {ru.weight.kg}
          </p>
        )}
      </div>

      {stats.trend === null ? (
        <p className="text-sm text-slate-500">{ru.weight.noData}</p>
      ) : (
        <>
          <dl className="grid grid-cols-3 gap-2 text-center">
            <Stat label={ru.weight.lost} value={fmt(stats.lostKg)} unit={ru.weight.kg} />
            <Stat label={ru.weight.toGoal} value={fmt(stats.toGoalKg)} unit={ru.weight.kg} />
            <Stat label={ru.weight.goal} value={fmt(stats.goalWeight)} unit={ru.weight.kg} />
          </dl>

          <Rate stats={stats} />
          <ForecastLine forecast={stats.forecast} />
        </>
      )}
    </section>
  );
}

function Rate({ stats }: { stats: WeightStats }) {
  if (stats.ratePerWeek === null) {
    return (
      <p className="text-sm text-slate-500">
        {ru.weight.rate}: {ru.weight.rateNeedsData}
      </p>
    );
  }

  const corridor =
    stats.rateInCorridor === null
      ? null
      : stats.rateInCorridor
        ? ru.weight.corridorOk
        : (stats.ratePercent ?? 0) > 1
          ? ru.weight.corridorFast
          : ru.weight.corridorSlow;

  return (
    <p className="text-sm">
      <span className="text-slate-500">{ru.weight.rate}: </span>
      <span className="font-medium tabular-nums">
        {stats.ratePerWeek > 0 ? '+' : ''}
        {stats.ratePerWeek.toFixed(2)} {ru.weight.ratePerWeek}
      </span>
      {stats.ratePercent !== null && (
        <span className="text-slate-500"> · {stats.ratePercent}% массы</span>
      )}
      {corridor && (
        <span className={`block text-xs ${stats.rateInCorridor ? 'text-green-700' : 'text-amber-700'}`}>
          {corridor}
        </span>
      )}
    </p>
  );
}

function ForecastLine({ forecast }: { forecast: Forecast }) {
  const text =
    forecast.kind === 'ETA'
      ? `${formatDate(forecast.date)} · ${forecast.weeks} ${ru.weight.weeks}`
      : forecast.kind === 'REACHED'
        ? ru.weight.forecastReached
        : forecast.kind === 'STALLED'
          ? ru.weight.forecastStalled
          : forecast.kind === 'WRONG_DIRECTION'
            ? ru.weight.forecastWrongWay
            : ru.weight.forecastNoData;

  return (
    <p className="text-sm">
      <span className="text-slate-500">{ru.weight.forecast}: </span>
      <span className="font-medium">{text}</span>
      {/* FR-4.5 требует явной пометки: это экстраполяция, а не обещание. */}
      {forecast.kind === 'ETA' && (
        <span className="block text-xs text-slate-500">{ru.weight.forecastNote}</span>
      )}
    </p>
  );
}

function History({ points }: { points: TrendPoint[] }) {
  const remove = useDeleteWeight();
  const measured = [...points].filter((point) => point.kg !== null).reverse();

  if (measured.length === 0) {
    return <p className="text-sm text-slate-500">{ru.weight.historyEmpty}</p>;
  }

  return (
    <section className="flex flex-col gap-1">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
        {ru.weight.history}
      </h2>

      <ul className="divide-y divide-slate-100">
        {measured.map((point) => (
          <li key={point.date} className="flex min-h-11 items-center gap-3 py-2">
            <span className="flex-1 text-sm tabular-nums">{formatDate(point.date)}</span>
            <span className="tabular-nums">
              {point.kg} {ru.weight.kg}
            </span>
            <span className="w-20 text-right text-xs tabular-nums text-slate-500">
              {point.trend === null ? '' : `${ru.weight.trend} ${point.trend.toFixed(1)}`}
            </span>
            <button
              type="button"
              aria-label={ru.weight.delete}
              disabled={remove.isPending}
              onClick={() => {
                if (window.confirm(ru.weight.deleteConfirm)) remove.mutate(point.date);
              }}
              className="min-h-11 w-11 shrink-0 text-slate-400 disabled:opacity-50"
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Stat({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="tabular-nums">
        <span className="font-semibold">{value}</span>
        {value !== ru.common.dash && (
          <span className="ml-1 text-xs font-normal text-slate-500">{unit}</span>
        )}
      </dd>
    </div>
  );
}

function fmt(value: number | null): string {
  return value === null ? ru.common.dash : value.toFixed(1);
}

function formatDate(date: string): string {
  return `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(2, 4)}`;
}
