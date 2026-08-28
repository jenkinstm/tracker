"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Empty, ErrorBox, Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import { number, requests, rubles } from "@/lib/format";
import type { AppConfig, ImportReport, Keyword, Page, Project, WordstatCost } from "@/lib/types";

export function KeywordsPanel({ project, config }: { project: Project; config?: AppConfig }) {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [text, setText] = useState("");
  const [report, setReport] = useState<ImportReport | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const keywords = useQuery({
    queryKey: ["keywords", project.id, page, query],
    queryFn: () =>
      api.get<Page<Keyword>>(
        `/api/projects/${project.id}/keywords?page=${page}&size=50&q=${encodeURIComponent(query)}`,
      ),
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["keywords", project.id] });
    queryClient.invalidateQueries({ queryKey: ["project", project.id] });
  };

  const importText = useMutation({
    mutationFn: () => api.post<ImportReport>(`/api/projects/${project.id}/keywords/import`, { text }),
    onSuccess: (data) => {
      setReport(data);
      setText("");
      refresh();
    },
  });

  const importFile = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return api.upload<ImportReport>(`/api/projects/${project.id}/keywords/import-file`, form);
    },
    onSuccess: (data) => {
      setReport(data);
      refresh();
    },
  });

  const estimate = useQuery({
    queryKey: ["wordstat-estimate", project.id, keywords.data?.total],
    queryFn: () =>
      api.post<WordstatCost>(`/api/projects/${project.id}/wordstat/estimate`, {
        only_missing: true,
      }),
  });

  const collect = useMutation({
    mutationFn: () =>
      api.post<{ task_id: string }>(`/api/projects/${project.id}/wordstat/collect`, {
        only_missing: true,
      }),
    onSuccess: () => {
      setTimeout(refresh, 2500);
    },
  });

  const total = keywords.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / 50));

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card p-4">
          <div className="text-sm font-medium">Загрузить семантику</div>
          <p className="mt-1 text-xs text-muted">
            Одна фраза на строку. Дубли схлопнутся, лишние пробелы и регистр приведутся сами.
          </p>
          <textarea
            className="field mt-3 h-28 py-2"
            placeholder={"купить пластиковые окна\nостекление балкона\n…"}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              className="btn-primary"
              disabled={!text.trim() || importText.isPending}
              onClick={() => importText.mutate()}
            >
              Добавить фразы
            </button>
            <button className="btn-secondary" onClick={() => fileInput.current?.click()}>
              Загрузить CSV или XLSX
            </button>
            <input
              ref={fileInput}
              type="file"
              accept=".csv,.tsv,.txt,.xlsx"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) importFile.mutate(file);
                e.target.value = "";
              }}
            />
          </div>
          {importText.error ? <div className="mt-3"><ErrorBox error={importText.error} /></div> : null}
          {importFile.error ? <div className="mt-3"><ErrorBox error={importFile.error} /></div> : null}
          {report ? (
            <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm">
              Добавлено <b>{report.added}</b>. Отброшено: дублей в файле {report.duplicates_in_file},
              уже было в проекте {report.duplicates_in_project}, пустых {report.empty}
              {report.too_long ? `, слишком длинных ${report.too_long}` : ""}.
            </div>
          ) : null}
        </div>

        <div className="card p-4">
          <div className="text-sm font-medium">Частотность</div>
          <p className="mt-1 text-xs text-muted">
            Самая дорогая операция сервиса — втрое дороже съёма позиций. По умолчанию собираем
            только то, чего ещё нет; снимки моложе {config?.wordstat_fresh_days ?? 30} дней
            пропускаются.
          </p>
          {estimate.data ? (
            <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm">
              К сбору <b>{estimate.data.keywords}</b> из {estimate.data.total_selected} фраз,{" "}
              {requests(estimate.data.requests)}, {rubles(estimate.data.cost_kopecks)}.
              {estimate.data.fresh_skipped > 0 ? (
                <span className="block text-xs text-muted">
                  Пропущено как свежие: {estimate.data.fresh_skipped}.
                </span>
              ) : null}
            </div>
          ) : null}
          <button
            className="btn-primary mt-3"
            disabled={collect.isPending || !estimate.data?.keywords}
            onClick={() => collect.mutate()}
          >
            Собрать частотность
          </button>
          {collect.isSuccess ? (
            <p className="mt-2 text-xs text-muted">Задача в очереди, список обновится сам.</p>
          ) : null}
          {collect.error ? <div className="mt-3"><ErrorBox error={collect.error} /></div> : null}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <input
          className="field max-w-xs"
          placeholder="Поиск по фразам"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(1);
          }}
        />
        <span className="text-sm text-muted">всего {number(total)}</span>
      </div>

      {keywords.isLoading ? <Spinner /> : null}
      {keywords.error ? <ErrorBox error={keywords.error} /> : null}
      {keywords.data?.items.length === 0 ? (
        <Empty title="Фраз пока нет" hint="Вставьте список выше или загрузите файл." />
      ) : null}

      {keywords.data && keywords.data.items.length > 0 ? (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[700px] text-sm">
            <thead className="border-b border-line bg-slate-50 text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Фраза</th>
                <th className="px-3 py-2 font-medium">Группа</th>
                <th className="px-3 py-2 text-right font-medium">Частотность (широкая)</th>
                <th className="px-3 py-2 font-medium">Целевой URL</th>
              </tr>
            </thead>
            <tbody>
              {keywords.data.items.map((keyword) => (
                <tr key={keyword.id} className="border-b border-line last:border-0">
                  <td className="px-3 py-2">{keyword.phrase}</td>
                  <td className="px-3 py-2 text-muted">{keyword.group_name ?? "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{number(keyword.freq_base)}</td>
                  <td className="max-w-xs truncate px-3 py-2 text-muted" title={keyword.target_url ?? ""}>
                    {keyword.target_url ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {pages > 1 ? (
        <div className="flex items-center gap-2">
          <button className="btn-secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Назад
          </button>
          <span className="text-sm text-muted">
            {page} из {pages}
          </span>
          <button className="btn-secondary" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            Вперёд
          </button>
        </div>
      ) : null}
    </div>
  );
}
