"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { shortDate } from "@/lib/format";
import type { VisibilityPoint } from "@/lib/types";

export function VisibilityChart({ points }: { points: VisibilityPoint[] }) {
  if (points.length === 0) {
    return (
      <div className="card p-6 text-sm text-muted">
        Видимость появится после первого съёма.
      </div>
    );
  }

  return (
    <div className="card p-4">
      <div className="mb-1 text-sm font-medium">Видимость проекта</div>
      <p className="mb-4 text-xs text-muted">
        Доля фраз в ТОП-3 / ТОП-10 / ТОП-50, взвешенная по частотности.
      </p>
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="checked_on"
              tickFormatter={shortDate}
              stroke="#94a3b8"
              fontSize={12}
              tickLine={false}
            />
            <YAxis
              unit="%"
              stroke="#94a3b8"
              fontSize={12}
              tickLine={false}
              axisLine={false}
              domain={[0, 100]}
            />
            <Tooltip
              labelFormatter={(value) => shortDate(String(value))}
              formatter={(value: number, name: string) => [`${value}%`, name]}
              contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 12 }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line type="monotone" dataKey="top3" name="ТОП-3" stroke="#059669" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="top10" name="ТОП-10" stroke="#2563eb" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="top50" name="ТОП-50" stroke="#94a3b8" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
