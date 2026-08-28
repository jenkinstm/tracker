"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { Shell } from "@/components/Shell";
import { KeywordsPanel } from "@/components/project/KeywordsPanel";
import { ReportTable } from "@/components/project/ReportTable";
import { RunPanel } from "@/components/project/RunPanel";
import { VisibilityChart } from "@/components/project/VisibilityChart";
import { ErrorBox, Spinner, Stat } from "@/components/ui";
import { api, download } from "@/lib/api";
import { fullDate, number } from "@/lib/format";
import type { AppConfig, Group, Project, Report, Summary, VisibilityPoint } from "@/lib/types";

type Tab = "report" | "keywords" | "runs";

const CHANGE_FILTERS = [
  { value: "", label: "Все" },
  { value: "up", label: "Выросли" },
  { value: "down", label: "Упали" },
  { value: "top10", label: "В ТОП-10" },
  { value: "top3", label: "В ТОП-3" },
  { value: "lost", label: "Вне выдачи" },
];

export default function ProjectPage() {
  return (
    <Shell>
      <ProjectView />
    </Shell>
  );
}

function ProjectView() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;
  const [tab, setTab] = useState<Tab>("report");

  const config = useQuery({
    queryKey: ["config"],
    queryFn: () => api.get<AppConfig>("/api/config"),
    staleTime: Infinity,
  });

  const project = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => api.get<Project>(`/api/projects/${projectId}`),
  });

  if (project.isLoading) return <Spinner />;
  if (project.error) return <ErrorBox error={project.error} />;
  if (!project.data) return null;

  const data = project.data;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/" className="text-sm text-muted hover:underline">
            ← Все проекты
          </Link>
          <h1 className="mt-1 text-xl font-semibold">{data.name}</h1>
          <p className="text-sm text-muted">
            {data.domain} · Яндекс, регион {data.targets[0]?.region_code ?? "—"} · ТОП-
            {data.targets[0]?.depth ?? 100}
            {data.match_subdomains ? " · с поддоменами" : ""}
          </p>
        </div>
        <nav className="flex gap-1 rounded-lg bg-slate-100 p-1">
          {(
            [
              ["report", "Отчёт"],
              ["keywords", "Семантика"],
              ["runs", "Съёмы"],
            ] as [Tab, string][]
          ).map(([value, label]) => (
            <button
              key={value}
              className={`btn px-4 ${tab === value ? "bg-white shadow-sm" : "text-muted"}`}
              onClick={() => setTab(value)}
            >
              {label}
            </button>
          ))}
        </nav>
      </div>

      {tab === "report" ? <ReportTab projectId={projectId} /> : null}
      {tab === "keywords" ? <KeywordsPanel project={data} config={config.data} /> : null}
      {tab === "runs" ? <RunPanel project={data} config={config.data} /> : null}
    </div>
  );
}

function ReportTab({ projectId }: { projectId: string }) {
  const [groupId, setGroupId] = useState("");
  const [change, setChange] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);

  const filters = new URLSearchParams({ page: String(page), size: "100" });
  if (groupId) filters.set("group_id", groupId);
  if (change) filters.set("change", change);
  if (query) filters.set("q", query);
  const exportFilters = new URLSearchParams(filters);
  exportFilters.delete("page");
  exportFilters.delete("size");

  const summary = useQuery({
    queryKey: ["summary", projectId],
    queryFn: () => api.get<Summary>(`/api/projects/${projectId}/summary`),
  });
  const visibility = useQuery({
    queryKey: ["visibility", projectId],
    queryFn: () => api.get<VisibilityPoint[]>(`/api/projects/${projectId}/visibility`),
  });
  const groups = useQuery({
    queryKey: ["groups", projectId],
    queryFn: () => api.get<Group[]>(`/api/projects/${projectId}/groups`),
  });
  const report = useQuery({
    queryKey: ["report", projectId, filters.toString()],
    queryFn: () => api.get<Report>(`/api/projects/${projectId}/report?${filters}`),
  });

  const pages = report.data ? Math.max(1, Math.ceil(report.data.total / report.data.size)) : 1;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat
          label="Съём"
          value={fullDate(summary.data?.checked_on)}
          hint={summary.data ? `${number(summary.data.keywords)} фраз` : undefined}
        />
        <Stat label="В ТОП-3" value={number(summary.data?.in_top3)} />
        <Stat label="В ТОП-10" value={number(summary.data?.in_top10)} />
        <Stat
          label="Средняя"
          value={summary.data?.average_position ?? "—"}
          hint="усиливает единичные вылеты"
        />
        <Stat
          label="Медиана"
          value={summary.data?.median_position ?? "—"}
          hint="устойчива к вылетам"
        />
      </div>

      {visibility.data ? <VisibilityChart points={visibility.data} /> : null}

      <div className="flex flex-wrap items-center gap-2">
        <select
          className="field max-w-[200px]"
          value={groupId}
          onChange={(e) => {
            setGroupId(e.target.value);
            setPage(1);
          }}
        >
          <option value="">Все группы</option>
          {groups.data?.map((group) => (
            <option key={group.id} value={group.id}>
              {group.name} ({group.keywords_count})
            </option>
          ))}
        </select>

        <div className="flex flex-wrap gap-1">
          {CHANGE_FILTERS.map((filter) => (
            <button
              key={filter.value}
              className={`btn px-3 ${
                change === filter.value ? "bg-accent text-white" : "btn-secondary"
              }`}
              onClick={() => {
                setChange(filter.value);
                setPage(1);
              }}
            >
              {filter.label}
            </button>
          ))}
        </div>

        <input
          className="field max-w-[220px]"
          placeholder="Поиск по фразам"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(1);
          }}
        />

        <div className="ml-auto flex gap-2">
          <button
            className="btn-secondary"
            onClick={() =>
              download(`/api/projects/${projectId}/export.csv?${exportFilters}`, "rankpulse.csv")
            }
          >
            CSV
          </button>
          <button
            className="btn-secondary"
            onClick={() =>
              download(`/api/projects/${projectId}/export.xlsx?${exportFilters}`, "rankpulse.xlsx")
            }
          >
            XLSX
          </button>
        </div>
      </div>

      {report.isLoading ? <Spinner /> : null}
      {report.error ? <ErrorBox error={report.error} /> : null}
      {report.data ? (
        <>
          <p className="text-xs text-muted">
            Позиции на {fullDate(report.data.checked_on)}
            {report.data.previous_checked_on
              ? `, сравнение со съёмом ${fullDate(report.data.previous_checked_on)}`
              : ", предыдущего съёма ещё нет"}
            . Найдено {number(report.data.total)}.
          </p>
          <ReportTable report={report.data} />
          {pages > 1 ? (
            <div className="flex items-center gap-2">
              <button className="btn-secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Назад
              </button>
              <span className="text-sm text-muted">
                {page} из {pages}
              </span>
              <button
                className="btn-secondary"
                disabled={page >= pages}
                onClick={() => setPage((p) => p + 1)}
              >
                Вперёд
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
