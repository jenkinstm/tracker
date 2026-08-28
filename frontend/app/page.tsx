"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { Shell } from "@/components/Shell";
import { Empty, ErrorBox, KeywordsCount, Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import { fullDate, runStatus } from "@/lib/format";
import type { Project, Region } from "@/lib/types";

export default function ProjectsPage() {
  return (
    <Shell>
      <Projects />
    </Shell>
  );
}

function Projects() {
  const [creating, setCreating] = useState(false);
  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.get<Project[]>("/api/projects"),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Проекты</h1>
        <button className="btn-primary" onClick={() => setCreating((v) => !v)}>
          {creating ? "Отмена" : "Новый проект"}
        </button>
      </div>

      {creating ? <CreateProject onDone={() => setCreating(false)} /> : null}

      {projects.isLoading ? <Spinner /> : null}
      {projects.error ? <ErrorBox error={projects.error} /> : null}

      {projects.data && projects.data.length === 0 && !creating ? (
        <Empty
          title="Проектов пока нет"
          hint="Заведите первый: домен, регион и расписание — дальше можно грузить семантику."
        />
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {projects.data?.map((project) => (
          <Link key={project.id} href={`/projects/${project.id}`} className="card block p-4 hover:border-accent">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-medium">{project.name}</div>
                <div className="text-sm text-muted">{project.domain}</div>
              </div>
              <span className="chip bg-slate-100 text-slate-600">
                {project.schedule === "manual"
                  ? "вручную"
                  : project.schedule === "daily"
                    ? "ежедневно"
                    : "еженедельно"}
              </span>
            </div>
            <div className="mt-3 flex items-center justify-between text-sm text-muted">
              <span><KeywordsCount count={project.keywords_count} /></span>
              <span>
                {project.last_run
                  ? `${fullDate(project.last_run.scheduled_for)} · ${runStatus[project.last_run.status]}`
                  : "съёмов не было"}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function CreateProject({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [regionCode, setRegionCode] = useState("213");
  const [matchSubdomains, setMatchSubdomains] = useState(false);
  const [fixTypos, setFixTypos] = useState(true);
  const [schedule, setSchedule] = useState<"manual" | "weekly" | "daily">("weekly");

  const regions = useQuery({
    queryKey: ["regions"],
    queryFn: () => api.get<Region[]>("/api/regions?limit=100"),
  });

  const create = useMutation({
    mutationFn: () =>
      api.post<Project>("/api/projects", {
        name,
        domain,
        region_code: regionCode,
        match_subdomains: matchSubdomains,
        fix_typos: fixTypos,
        schedule,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      onDone();
    },
  });

  return (
    <form
      className="card space-y-4 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="name">Название</label>
          <input id="name" className="field" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div>
          <label className="label" htmlFor="domain">Домен</label>
          <input
            id="domain"
            className="field"
            placeholder="example.ru"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="label" htmlFor="region">Регион Яндекса</label>
          <select id="region" className="field" value={regionCode} onChange={(e) => setRegionCode(e.target.value)}>
            {(regions.data ?? [{ code: "213", name: "Москва", parent_code: null }]).map((region) => (
              <option key={region.code} value={region.code}>
                {region.name} ({region.code})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="schedule">Расписание</label>
          <select
            id="schedule"
            className="field"
            value={schedule}
            onChange={(e) => setSchedule(e.target.value as typeof schedule)}
          >
            <option value="manual">вручную</option>
            <option value="weekly">раз в неделю</option>
            <option value="daily">каждый день</option>
          </select>
          <p className="mt-1 text-xs text-muted">
            Съём в 08:00 по времени проекта: утренняя выдача заметно стабильнее вечерней.
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4"
            checked={matchSubdomains}
            onChange={(e) => setMatchSubdomains(e.target.checked)}
          />
          <span>
            Учитывать поддомены
            <span className="block text-xs text-muted">
              Включайте, если у сайта есть поддомены: позиция определится независимо от того,
              что именно ранжируется.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4"
            checked={fixTypos}
            onChange={(e) => setFixTypos(e.target.checked)}
          />
          <span>
            Исправлять опечатки
            <span className="block text-xs text-muted">
              Отключать не стоит: поиск сам правит запрос, и мерить неисправленную выдачу —
              значит мерить то, чего пользователь не видит.
            </span>
          </span>
        </label>
      </div>

      <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-muted">
        Глубина проверки — ТОП-100. В Яндексе сотня приходит одним запросом и стоит столько же,
        сколько десятка, поэтому выбор здесь не нужен.
      </div>

      {create.error ? <ErrorBox error={create.error} /> : null}

      <div className="flex gap-2">
        <button className="btn-primary" disabled={create.isPending}>Создать</button>
        <button type="button" className="btn-secondary" onClick={onDone}>Отмена</button>
      </div>
    </form>
  );
}
