import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';

import { ru } from '../i18n/ru.js';
import { useSession } from '../lib/session.js';

export function RequireAuth({ children }: { children: ReactNode }) {
  const { data: session, isPending } = useSession();

  // Пока сессия не проверена, редиректить нельзя — иначе перезагрузка страницы
  // на секунду выбрасывает на логин у уже вошедшего пользователя.
  if (isPending) {
    return <p className="p-4">{ru.common.loading}</p>;
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
