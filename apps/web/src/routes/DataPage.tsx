import { backupSchema, totalRecords } from '@tracker/shared';
import { type ChangeEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import { ru } from '../i18n/ru.js';
import { ApiError, api } from '../lib/api.js';

type ImportState =
  | { kind: 'idle' }
  | { kind: 'ready'; backup: unknown; records: number; name: string }
  | { kind: 'busy' }
  | { kind: 'done'; records: number }
  | { kind: 'error'; message: string };

/** Экспорт и восстановление (FR-8.1, FR-8.3). */
export function DataPage() {
  const queryClient = useQueryClient();
  const [state, setState] = useState<ImportState>({ kind: 'idle' });

  function download() {
    // Ходим обычной навигацией: браузер сам сохранит файл по
    // Content-Disposition, и держать выгрузку в памяти вкладки не нужно.
    window.location.href = '/api/export';
  }

  async function pickFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const parsed = backupSchema.safeParse(JSON.parse(await file.text()));

      if (!parsed.success) {
        setState({ kind: 'error', message: ru.data.badFile });
        return;
      }

      setState({
        kind: 'ready',
        backup: parsed.data,
        records: totalRecords(parsed.data),
        name: file.name,
      });
    } catch {
      setState({ kind: 'error', message: ru.data.badFile });
    }
  }

  async function runImport(replace: boolean) {
    if (state.kind !== 'ready') return;

    const { backup, records } = state;
    setState({ kind: 'busy' });

    try {
      await api.post('/api/import', { backup, replace });
      // После восстановления в кэше лежит вся старая история.
      queryClient.clear();
      setState({ kind: 'done', records });
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setState({ kind: 'ready', backup, records, name: '' });
        setState({ kind: 'error', message: ru.data.notEmpty });
        return;
      }
      setState({ kind: 'error', message: ru.data.importError });
    }
  }

  return (
    <main className="mx-auto flex max-w-md flex-col gap-6 p-4">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{ru.data.heading}</h1>
        <Link to="/profile" className="min-h-11 py-3 text-sm underline">
          {ru.common.back}
        </Link>
      </header>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          {ru.data.exportHeading}
        </h2>
        <p className="text-sm text-slate-600">{ru.data.exportNote}</p>
        <button
          type="button"
          onClick={download}
          className="min-h-11 rounded bg-slate-800 text-white"
        >
          {ru.data.exportButton}
        </button>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          {ru.data.importHeading}
        </h2>
        <p className="text-sm text-slate-600">{ru.data.importNote}</p>

        <input
          type="file"
          accept="application/json,.json"
          onChange={pickFile}
          className="min-h-11 text-sm"
        />

        {state.kind === 'ready' && (
          <div className="flex flex-col gap-2 rounded border border-amber-300 bg-amber-50 p-3">
            <p className="text-sm">
              {state.name}: {state.records} {ru.data.records}
            </p>
            <p className="text-sm text-amber-800">{ru.data.replaceWarning}</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => runImport(false)}
                className="min-h-11 flex-1 rounded border border-slate-300"
              >
                {ru.data.importEmpty}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(ru.data.replaceConfirm)) void runImport(true);
                }}
                className="min-h-11 flex-1 rounded bg-red-700 text-white"
              >
                {ru.data.importReplace}
              </button>
            </div>
          </div>
        )}

        {state.kind === 'busy' && <p className="text-sm text-slate-500">{ru.data.importing}</p>}

        {state.kind === 'done' && (
          <p className="text-sm text-green-700">
            {ru.data.imported}: {state.records} {ru.data.records}
          </p>
        )}

        {state.kind === 'error' && (
          <p role="alert" className="text-sm text-red-700">
            {state.message}
          </p>
        )}
      </section>
    </main>
  );
}
