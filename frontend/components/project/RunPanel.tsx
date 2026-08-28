"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ErrorBox } from "@/components/ui";
import { api } from "@/lib/api";
import { dateTime, fullDate, rubles, runStatus } from "@/lib/format";
import type { AppConfig, Cost, Project, Run } from "@/lib/types";

const STATUS_TONE: Record<string, string> = {
  queued: "bg-slate-100 text-slate-600",
  running: "bg-blue-50 text-blue-700",
  done: "bg-emerald-50 text-emerald-700",
  partial: "bg-amber-50 text-amber-700",
  failed: "bg-red-50 text-red-700",
};

export function RunPanel({ project, config }: { project: Project; config?: AppConfig }) {
  const queryClient = useQueryClient();

  const estimate = useQuery({
    queryKey: ["estimate", project.id],
    queryFn: () => api.get<Cost>(`/api/projects/${project.id}/runs/estimate`),
  });

  const runs = useQuery({
    queryKey: ["runs", project.id],
    queryFn: () => api.get<Run[]>(`/api/projects/${project.id}/runs?limit=10`),
    // Пока съём идёт, прогресс должен обновляться сам: застрявший опрашивальщик
    // обязан быть виден пользователю, а не только в логах.
    refetchInterval: (query) =>
      query.state.data?.some((run) => run.status === "running" || run.status === "queued")
        ? 5000
        : false,
  });

  const start = useMutation({
    mutationFn: () => api.post<Run>(`/api/projects/${project.id}/runs`, { force: true }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["runs", project.id] });
      queryClient.invalidateQueries({ queryKey: ["report", project.id] });
    },
  });

  const active = runs.data?.find((run) => run.status === "running" || run.status === "queued");

  return (
    <div className="space-y-3">
      <div className="card p-4">
        <div className="text-sm font-medium">Съём позиций</div>
        {estimate.data ? (
          <p className="mt-1 text-sm text-muted">
            {estimate.data.keywords} фраз → {estimate.data.requests} запросов к API,{" "}
            <span className="font-medium text-ink">{rubles(estimate.data.cost_kopecks)}</span>{" "}
            {estimate.data.mode === "deferred" ? "(отложенный режим)" : "(синхронный режим)"}
          </p>
        ) : null}
        {config?.serp_provider === "mock" ? (
          <p className="mt-1 text-xs text-amber-700">
            Провайдер — заглушка: выдача синтетическая, деньги не тратятся. Для боевых данных
            задайте SERP_PROVIDER=yandex и ключ сервисного аккаунта.
          </p>
        ) : (
          <p className="mt-1 text-xs text-muted">
            Отложенный результат хранится {config?.deferred_ttl_hours ?? 12} часов, опрашивальщик
            забирает его автоматически.
          </p>
        )}

        {start.error ? <div className="mt-3"><ErrorBox error={start.error} /></div> : null}

        <button
          className="btn-primary mt-3"
          disabled={start.isPending || Boolean(active) || project.keywords_count === 0}
          onClick={() => start.mutate()}
        >
          {active ? "Съём уже идёт" : "Снять позиции"}
        </button>
      </div>

      <div className="card divide-y divide-line">
        {runs.data?.length ? (
          runs.data.map((run) => (
            <div key={run.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm">
              <span className="w-24 font-medium tabular-nums">{fullDate(run.scheduled_for)}</span>
              <span className={`chip ${STATUS_TONE[run.status]}`}>{runStatus[run.status]}</span>
              <span className="text-muted">
                снято {run.keywords_done} из {run.keywords_total}
                {run.keywords_pending > 0 ? `, ждёт ответа ${run.keywords_pending}` : ""}
                {run.keywords_failed > 0 ? `, не удалось ${run.keywords_failed}` : ""}
              </span>
              <span className="text-muted">{run.trigger === "manual" ? "вручную" : "по расписанию"}</span>
              <span className="ml-auto tabular-nums text-muted">{rubles(run.cost_kopecks)}</span>
              <span className="w-32 text-right text-xs text-muted">{dateTime(run.finished_at)}</span>
              {run.error ? <div className="w-full text-xs text-red-700">{run.error}</div> : null}
            </div>
          ))
        ) : (
          <div className="px-4 py-6 text-sm text-muted">Съёмов ещё не было.</div>
        )}
      </div>
    </div>
  );
}
