import { ru } from '../i18n/ru.js';
import { useLogout } from '../lib/session.js';

export function HomePage() {
  const logout = useLogout();

  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 p-4">
      <h1 className="text-xl font-semibold">{ru.home.heading}</h1>
      <p className="text-sm">{ru.home.placeholder}</p>

      <button
        type="button"
        onClick={() => logout.mutate()}
        disabled={logout.isPending}
        className="min-h-11 self-start rounded border px-4 disabled:opacity-50"
      >
        {ru.home.logout}
      </button>
    </main>
  );
}
