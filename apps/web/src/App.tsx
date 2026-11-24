import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { AllocationsPage } from './pages/allocations/AllocationsPage';
import { LoginPage } from './pages/LoginPage';
import { PlannedPage } from './pages/PlannedPage';
import { StockPage } from './pages/stock/StockPage';
import { RequireAuth } from './routes/RequireAuth';

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="/stock" replace />} />
        <Route path="/stock" element={<StockPage />} />
        <Route path="/allocations" element={<AllocationsPage />} />
        <Route path="/planned/:slug" element={<PlannedPage />} />
        <Route path="*" element={<Navigate to="/stock" replace />} />
      </Route>
    </Routes>
  );
}
