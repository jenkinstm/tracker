import { Navigate, Route, Routes } from 'react-router-dom';

import { RequireAuth } from './components/RequireAuth.js';
import { AddEntryPage } from './routes/AddEntryPage.js';
import { EditEntryPage } from './routes/EditEntryPage.js';
import { HomePage } from './routes/HomePage.js';
import { LoginPage } from './routes/LoginPage.js';
import { NewFoodPage } from './routes/NewFoodPage.js';
import { ProfilePage } from './routes/ProfilePage.js';

const PROTECTED = [
  { path: '/', element: <HomePage /> },
  { path: '/profile', element: <ProfilePage /> },
  { path: '/add', element: <AddEntryPage /> },
  { path: '/diary/:id', element: <EditEntryPage /> },
  { path: '/foods/new', element: <NewFoodPage /> },
];

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      {PROTECTED.map(({ path, element }) => (
        <Route key={path} path={path} element={<RequireAuth>{element}</RequireAuth>} />
      ))}

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
