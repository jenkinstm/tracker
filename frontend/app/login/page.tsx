"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, setToken } from "@/lib/api";
import { ErrorBox } from "@/components/ui";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("demo@rankpulse.ru");
  const [password, setPassword] = useState("rankpulse123");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const path = mode === "login" ? "/api/auth/login" : "/api/auth/register";
      const data = await api.post<{ access_token: string }>(path, { email, password });
      setToken(data.access_token);
      router.replace("/");
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={submit} className="card w-full max-w-sm p-6">
        <div className="mb-1 flex items-center gap-2 text-lg font-semibold">
          <span className="inline-block h-2 w-2 rounded-full bg-accent" />
          RankPulse
        </div>
        <p className="mb-6 text-sm text-muted">
          Позиции и частотность в Яндексе. Данные остаются на вашем сервере.
        </p>

        <label className="label" htmlFor="email">Почта</label>
        <input
          id="email"
          type="email"
          className="field mb-4"
          value={email}
          autoComplete="username"
          onChange={(e) => setEmail(e.target.value)}
          required
        />

        <label className="label" htmlFor="password">Пароль</label>
        <input
          id="password"
          type="password"
          className="field mb-4"
          value={password}
          minLength={8}
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          onChange={(e) => setPassword(e.target.value)}
          required
        />

        {error ? <div className="mb-4"><ErrorBox error={error} /></div> : null}

        <button className="btn-primary w-full" disabled={busy}>
          {mode === "login" ? "Войти" : "Создать аккаунт"}
        </button>
        <button
          type="button"
          className="btn-ghost mt-2 w-full"
          onClick={() => setMode(mode === "login" ? "register" : "login")}
        >
          {mode === "login" ? "У меня ещё нет аккаунта" : "У меня уже есть аккаунт"}
        </button>
      </form>
    </div>
  );
}
