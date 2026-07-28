import type { TrendPoint } from '@tracker/shared';
import {
  CartesianGrid,
  Line,
  ComposedChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { ru } from '../i18n/ru.js';

/**
 * График веса (FR-4.3): точки — сырые замеры, линия — тренд, пунктир — цель.
 *
 * Ряд приходит по календарным дням, поэтому разрыв во взвешиваниях виден
 * как разрыв, а не как соседние точки (критерий приёмки №6).
 */
export function WeightChart({
  points,
  goalWeight,
}: {
  points: TrendPoint[];
  goalWeight: number | null;
}) {
  if (points.length === 0) {
    return <p className="text-sm text-slate-500">{ru.weight.historyEmpty}</p>;
  }

  const values = points.flatMap((p) => [p.kg, p.trend].filter((v): v is number => v !== null));
  if (goalWeight !== null) values.push(goalWeight);

  const min = Math.floor(Math.min(...values) - 1);
  const max = Math.ceil(Math.max(...values) + 1);

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
          <CartesianGrid stroke="#e2e8f0" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={formatTick}
            tick={{ fontSize: 11 }}
            minTickGap={24}
          />
          <YAxis domain={[min, max]} tick={{ fontSize: 11 }} width={44} />
          <Tooltip
            formatter={(value, name) => [`${String(value)} ${ru.weight.kg}`, labelOf(name)]}
            labelFormatter={(label) => formatFull(String(label))}
          />

          {goalWeight !== null && (
            <ReferenceLine y={goalWeight} stroke="#0284c7" strokeDasharray="4 4" />
          )}

          {/* Сырые замеры точками: connectNulls не ставим, иначе разрыв
              в данных превратился бы в прямую и соврал. */}
          <Scatter dataKey="kg" fill="#94a3b8" />

          <Line
            type="monotone"
            dataKey="trend"
            stroke="#0f172a"
            strokeWidth={2}
            dot={false}
            connectNulls
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function labelOf(name: unknown): string {
  return name === 'trend' ? ru.weight.trend : ru.weight.latest;
}

function formatTick(date: string): string {
  return date.slice(8, 10) + '.' + date.slice(5, 7);
}

function formatFull(date: string): string {
  return `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}`;
}
