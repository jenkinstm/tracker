import { type FormEvent, useState } from 'react';
import { Navigate } from 'react-router-dom';

import { ru } from '../i18n/ru.js';
import { ApiError } from '../lib/api.js';
import { useLogin, useSession } from '../lib/session.js';

function errorText(error: unknown): string {
  if (error instanceof ApiError && error.status === 429) return ru.login.tooManyAttempts;
  if (error instanceof ApiError && error.status === 401) return ru.login.wrongPassword;
  return ru.login.networkError;
}

export function LoginPage() {
  const [password, setPassword] = useState('');
  const { data: session, isPending } = useSession();
  const login = useLogin();

  if (isPending) return <p className="p-4">{ru.common.loading}</p>;
  if (session) return <Navigate to="/" replace />;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    login.mutate(password);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-4">
      <h1 className="text-xl font-semibold">{ru.login.heading}</h1>

      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <label htmlFor="password" className="text-sm">
          {ru.login.passwordLabel}
        </label>
        <input
          id="password"
          type="password"
          value={password}
          autoComplete="current-password"
          onChange={(event) => setPassword(event.target.value)}
          className="min-h-11 rounded border px-3"
        />

        <button
          type="submit"
          disabled={login.isPending || password.length === 0}
          className="min-h-11 rounded bg-slate-800 text-white disabled:opacity-50"
        >
          {login.isPending ? ru.login.submitting : ru.login.submit}
        </button>
      </form>

      {login.isError && (
        <p role="alert" className="text-sm text-red-700">
          {errorText(login.error)}
        </p>
      )}
    </main>
  );
}
