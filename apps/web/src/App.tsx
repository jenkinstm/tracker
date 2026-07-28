import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

import { RequireAuth } from './components/RequireAuth.js';
import { ru } from './i18n/ru.js';
import { AddEntryPage } from './routes/AddEntryPage.js';
import { EditEntryPage } from './routes/EditEntryPage.js';
import { ExercisesPage } from './routes/ExercisesPage.js';
import { HomePage } from './routes/HomePage.js';
import { LoginPage } from './routes/LoginPage.js';
import { NewFoodPage } from './routes/NewFoodPage.js';
import { ProfilePage } from './routes/ProfilePage.js';
import { ProgramEditPage } from './routes/ProgramEditPage.js';
import { ProgramsPage } from './routes/ProgramsPage.js';
import { WorkoutPage } from './routes/WorkoutPage.js';

// Экран веса тянет за собой recharts — это больше сотни килобайт, которые
// на главном экране не нужны. Отдельным чанком, чтобы не ломать NFR-2.
const WeightPage = lazy(() =>
  import('./routes/WeightPage.js').then((module) => ({ default: module.WeightPage })),
);

const PROTECTED = [
  { path: '/', element: <HomePage /> },
  { path: '/profile', element: <ProfilePage /> },
  { path: '/add', element: <AddEntryPage /> },
  { path: '/diary/:id', element: <EditEntryPage /> },
  { path: '/foods/new', element: <NewFoodPage /> },
  { path: '/weight', element: <WeightPage /> },
  { path: '/workout', element: <WorkoutPage /> },
  { path: '/exercises', element: <ExercisesPage /> },
  { path: '/programs', element: <ProgramsPage /> },
  { path: '/programs/:id', element: <ProgramEditPage /> },
];

export function App() {
  return (
    <Suspense fallback={<p className="p-4">{ru.common.loading}</p>}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />

        {PROTECTED.map(({ path, element }) => (
          <Route key={path} path={path} element={<RequireAuth>{element}</RequireAuth>} />
        ))}

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
