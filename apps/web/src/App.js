import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { useAuth } from "./lib/auth";
import { Dashboard } from "./pages/Dashboard";
import { Connectors } from "./pages/Connectors";
import { Ledger } from "./pages/Ledger";
import { Login } from "./pages/Login";
import { Settings } from "./pages/Settings";
function LoadingScreen() {
    return (_jsx("div", { className: "flex min-h-screen items-center justify-center", children: _jsx("div", { className: "animate-pulseSoft text-sm text-muted-foreground", children: "Loading AICostLedger..." }) }));
}
function ProtectedLayout() {
    const { user } = useAuth();
    if (!user) {
        return _jsx(Navigate, { to: "/login", replace: true });
    }
    return (_jsx(AppShell, { children: _jsxs(Routes, { children: [_jsx(Route, { path: "/dashboard", element: _jsx(Dashboard, {}) }), _jsx(Route, { path: "/ledger", element: _jsx(Ledger, {}) }), _jsx(Route, { path: "/connectors", element: _jsx(Connectors, {}) }), _jsx(Route, { path: "/settings", element: _jsx(Settings, {}) }), _jsx(Route, { path: "*", element: _jsx(Navigate, { to: "/dashboard", replace: true }) })] }) }));
}
export default function App() {
    const { user, loading } = useAuth();
    if (loading) {
        return _jsx(LoadingScreen, {});
    }
    return (_jsxs(Routes, { children: [_jsx(Route, { path: "/login", element: user ? _jsx(Navigate, { to: "/dashboard", replace: true }) : _jsx(Login, {}) }), _jsx(Route, { path: "/*", element: _jsx(ProtectedLayout, {}) })] }));
}
