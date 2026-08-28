"use client";

import { useQuery } from "@tanstack/react-query";
import { Shell } from "@/components/Shell";
import { ErrorBox, Spinner, Stat } from "@/components/ui";
import { api } from "@/lib/api";
import { number, rubles } from "@/lib/format";
import type { Usage } from "@/lib/types";

const OPERATIONS: Record<string, string> = {
  serp_deferred: "Позиции, отложенный режим",
  serp_sync: "Позиции, синхронный режим",
  wordstat_top: "Частотность (Вордстат)",
};

export default function UsagePage() {
  return (
    <Shell>
      <UsageView />
    </Shell>
  );
}

function UsageView() {
  const usage = useQuery({ queryKey: ["usage"], queryFn: () => api.get<Usage>("/api/usage") });

  if (usage.isLoading) return <Spinner />;
  if (usage.error) return <ErrorBox error={usage.error} />;
  if (!usage.data) return null;

  const data = usage.data;
  const share = Math.min(100, Math.round((data.cost_kopecks / data.budget_kopecks) * 100));

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold">Расходы за {data.month}</h1>

      {data.limit_reached ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Месячный лимит исчерпан — новые задачи не стартуют. Поднимите лимит или дождитесь
          следующего месяца.
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Потрачено" value={rubles(data.cost_kopecks)} hint={`из ${rubles(data.budget_kopecks)}`} />
        <Stat
          label="Запросов"
          value={number(data.requests)}
          hint={`из ${number(data.request_limit)}`}
        />
        <Stat label="Доля бюджета" value={`${share}%`} />
      </div>

      <div className="card p-4">
        <div className="mb-3 text-sm font-medium">По операциям</div>
        <p className="mb-3 text-xs text-muted">
          Ставки разные: отложенный поиск — 30 ₽ за тысячу, синхронный — 488 ₽, Вордстат — 100 ₽.
          Одна общая цифра дала бы неверную себестоимость.
        </p>
        {data.by_operation.length === 0 ? (
          <p className="text-sm text-muted">В этом месяце расходов не было.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="py-2 font-medium">Операция</th>
                <th className="py-2 font-medium">Провайдер</th>
                <th className="py-2 text-right font-medium">Запросов</th>
                <th className="py-2 text-right font-medium">Сумма</th>
              </tr>
            </thead>
            <tbody>
              {data.by_operation.map((row) => (
                <tr key={`${row.provider}-${row.operation}`} className="border-b border-line last:border-0">
                  <td className="py-2">{OPERATIONS[row.operation] ?? row.operation}</td>
                  <td className="py-2 text-muted">{row.provider}</td>
                  <td className="py-2 text-right tabular-nums">{number(row.requests)}</td>
                  <td className="py-2 text-right tabular-nums">{rubles(row.cost_kopecks)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card p-4">
        <div className="mb-3 text-sm font-medium">По проектам</div>
        {data.by_project.length === 0 ? (
          <p className="text-sm text-muted">Пока пусто.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="py-2 font-medium">Проект</th>
                <th className="py-2 text-right font-medium">Запросов</th>
                <th className="py-2 text-right font-medium">Сумма</th>
              </tr>
            </thead>
            <tbody>
              {data.by_project.map((row) => (
                <tr key={row.project_id} className="border-b border-line last:border-0">
                  <td className="py-2">{row.name}</td>
                  <td className="py-2 text-right tabular-nums">{number(row.requests)}</td>
                  <td className="py-2 text-right tabular-nums">{rubles(row.cost_kopecks)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
