import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { useAuth } from "../lib/auth";
export function Login() {
    const { signIn, loading, blockedReason } = useAuth();
    return (_jsx("div", { className: "flex min-h-screen items-center justify-center px-6 py-10", children: _jsxs(Card, { className: "w-full max-w-lg animate-rise", children: [_jsxs(CardHeader, { children: [_jsx(CardTitle, { children: "Welcome back" }), _jsx(CardDescription, { children: "Sign in with Google to access your private AI cost ledger." })] }), _jsxs(CardContent, { className: "space-y-4", children: [blockedReason ? (_jsx("div", { className: "rounded-2xl border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-foreground", children: blockedReason })) : null, _jsx(Button, { onClick: signIn, disabled: loading, className: "w-full", size: "lg", children: "Continue with Google" }), _jsx("p", { className: "text-xs text-muted-foreground", children: "Your data stays in your Firebase project and can be exported anytime." })] })] }) }));
}
