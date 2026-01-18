import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { NavLink } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
const navItems = [
    { label: "Dashboard", to: "/dashboard" },
    { label: "Ledger", to: "/ledger" },
    { label: "Connectors", to: "/connectors" },
    { label: "Settings", to: "/settings" }
];
export function AppShell({ children }) {
    const { signOut, user } = useAuth();
    return (_jsxs("div", { className: "min-h-screen px-6 py-8", children: [_jsxs("header", { className: "flex flex-col gap-6 md:flex-row md:items-center md:justify-between", children: [_jsxs("div", { children: [_jsx("p", { className: "text-xs uppercase tracking-[0.2em] text-muted-foreground", children: "AICostLedger" }), _jsx("h1", { className: "text-3xl font-semibold", children: "Spend ledger for AI providers" }), _jsx("p", { className: "text-sm text-muted-foreground", children: "Collector-driven invoices, unified ledger, CSV-ready bookkeeping." })] }), _jsxs("div", { className: "flex items-center gap-3", children: [_jsx("span", { className: "text-sm text-muted-foreground", children: user?.email }), _jsx(Button, { variant: "outline", size: "sm", onClick: signOut, children: "Sign out" })] })] }), _jsxs("div", { className: "mt-8 grid gap-6 lg:grid-cols-[240px_1fr]", children: [_jsx(Card, { className: "h-fit p-4", children: _jsx("nav", { className: "flex flex-col gap-2", children: navItems.map((item) => (_jsx(NavLink, { to: item.to, className: ({ isActive }) => [
                                    "rounded-2xl px-4 py-2 text-sm font-medium transition",
                                    isActive ? "bg-primary text-primary-foreground" : "hover:bg-muted"
                                ].join(" "), children: item.label }, item.to))) }) }), _jsx("main", { className: "space-y-6 animate-rise", children: children })] })] }));
}
