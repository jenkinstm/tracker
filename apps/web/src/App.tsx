import { Navigate, Route, Routes } from 'react-router-dom';

import { RequireAuth } from './components/RequireAuth.js';
import { HomePage } from './routes/HomePage.js';
import { LoginPage } from './routes/LoginPage.js';
import { ProfilePage } from './routes/ProfilePage.js';

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <HomePage />
          </RequireAuth>
        }
      />
      <Route
        path="/profile"
        element={
          <RequireAuth>
            <ProfilePage />
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
