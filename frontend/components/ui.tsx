"use client";

import { pluralize } from "@/lib/format";

export function Spinner({ label = "Загрузка" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-6 text-sm text-muted">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-accent" />
      {label}…
    </div>
  );
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="card p-10 text-center">
      <p className="text-sm font-medium">{title}</p>
      {hint ? <p className="mt-1 text-sm text-muted">{hint}</p> : null}
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : "Что-то пошло не так";
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
      {message}
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="card px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {hint ? <div className="mt-0.5 text-xs text-muted">{hint}</div> : null}
    </div>
  );
}

export function Delta({ value }: { value: number | null }) {
  if (value === null || value === 0) return <span className="text-muted">—</span>;
  const grew = value > 0;
  return (
    <span className={`font-medium tabular-nums ${grew ? "text-up" : "text-down"}`}>
      {grew ? "↑" : "↓"} {Math.abs(value)}
    </span>
  );
}

export function PositionCell({ value, depth }: { value: number | null; depth: number }) {
  if (value === null) return <span className="text-muted">&gt;{depth}</span>;
  const tone =
    value <= 3 ? "bg-emerald-50 text-emerald-700"
      : value <= 10 ? "bg-blue-50 text-blue-700"
      : value <= 50 ? "bg-slate-100 text-slate-700"
      : "bg-slate-50 text-muted";
  return <span className={`chip tabular-nums ${tone}`}>{value}</span>;
}

export function KeywordsCount({ count }: { count: number }) {
  return (
    <>
      {count} {pluralize(count, "фраза", "фразы", "фраз")}
    </>
  );
}
