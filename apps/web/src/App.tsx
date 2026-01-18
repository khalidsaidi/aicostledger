import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { useAuth } from "./lib/auth";
import { Dashboard } from "./pages/Dashboard";
import { Connectors } from "./pages/Connectors";
import { Ledger } from "./pages/Ledger";
import { Login } from "./pages/Login";
import { Settings } from "./pages/Settings";

function LoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="animate-pulseSoft text-sm text-muted-foreground">Loading AICostLedger...</div>
    </div>
  );
}

function ProtectedLayout() {
  const { user } = useAuth();
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  return (
    <AppShell>
      <Routes>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/ledger" element={<Ledger />} />
        <Route path="/connectors" element={<Connectors />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </AppShell>
  );
}

export default function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return <LoadingScreen />;
  }

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/dashboard" replace /> : <Login />} />
      <Route path="/*" element={<ProtectedLayout />} />
    </Routes>
  );
}
