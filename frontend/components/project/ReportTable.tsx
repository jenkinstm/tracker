"use client";

import { Delta, PositionCell } from "@/components/ui";
import { number } from "@/lib/format";
import type { Report } from "@/lib/types";

export function ReportTable({ report }: { report: Report }) {
  return (
    <div className="card overflow-x-auto">
      <table className="w-full min-w-[900px] text-sm">
        <thead className="border-b border-line bg-slate-50 text-left text-xs uppercase tracking-wide text-muted">
          <tr>
            <th className="px-3 py-2 font-medium">Фраза</th>
            <th className="px-3 py-2 font-medium">Группа</th>
            <th className="px-3 py-2 text-right font-medium">
              <abbr
                title="Базовая частотность Вордстата без операторов. Завышает трафик кратно — это ограничение официального API, а не ошибка."
                className="cursor-help no-underline decoration-dotted"
              >
                Частотность (широкая)
              </abbr>
            </th>
            <th className="px-3 py-2 text-center font-medium">Позиция</th>
            <th className="px-3 py-2 text-center font-medium">Прошлый съём</th>
            <th className="px-3 py-2 text-center font-medium">Дельта</th>
            <th className="px-3 py-2 font-medium">Ранжируется</th>
          </tr>
        </thead>
        <tbody>
          {report.items.map((row) => (
            <tr key={row.keyword_id} className="border-b border-line last:border-0 hover:bg-slate-50">
              <td className="max-w-xs px-3 py-2">
                <div className="truncate" title={row.phrase}>{row.phrase}</div>
              </td>
              <td className="px-3 py-2 text-muted">{row.group_name ?? "—"}</td>
              <td className="px-3 py-2 text-right tabular-nums">{number(row.freq_base)}</td>
              <td className="px-3 py-2 text-center">
                <PositionCell value={row.position} depth={report.depth} />
              </td>
              <td className="px-3 py-2 text-center tabular-nums text-muted">
                {row.previous_position ?? "—"}
              </td>
              <td className="px-3 py-2 text-center"><Delta value={row.delta} /></td>
              <td className="max-w-xs px-3 py-2">
                {row.url ? (
                  <div className="flex items-center gap-1">
                    <a
                      href={row.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="truncate text-accent hover:underline"
                      title={row.url}
                    >
                      {row.url.replace(/^https?:\/\//, "")}
                    </a>
                    {row.url_mismatch ? (
                      <span
                        className="chip shrink-0 bg-amber-50 text-amber-700"
                        title={`Целевой URL: ${row.target_url}. Ранжируется другая страница — частая причина, по которой фраза не растёт.`}
                      >
                        не та страница
                      </span>
                    ) : null}
                  </div>
                ) : (
                  <span className="text-muted">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {report.items.length === 0 ? (
        <div className="px-3 py-8 text-center text-sm text-muted">
          По выбранным фильтрам ничего нет.
        </div>
      ) : null}
    </div>
  );
}
