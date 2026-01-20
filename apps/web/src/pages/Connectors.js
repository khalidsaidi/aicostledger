import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { useApi } from "../lib/api";
import { useAuth } from "../lib/auth";
import { fetchConnectors } from "../lib/data";
const PROVIDERS = [
    {
        id: "openai_chatgpt",
        label: "OpenAI ChatGPT",
        description: "Subscription invoices from ChatGPT billing portal."
    },
    {
        id: "openai_api",
        label: "OpenAI API",
        description: "API usage invoices and charges from the OpenAI platform."
    },
    {
        id: "anthropic_claude",
        label: "Claude (subscription)",
        description: "Claude subscription receipts when available."
    },
    {
        id: "anthropic_api",
        label: "Anthropic API",
        description: "Console invoices and API billing history."
    },
    {
        id: "cursor",
        label: "Cursor",
        description: "Cursor billing portal invoices (Stripe)."
    },
    {
        id: "manus",
        label: "Manus",
        description: "Manus billing portal invoices (Stripe if routed)."
    }
];
function formatMonth(date) {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    return `${year}-${month}`;
}
function shiftMonth(date, offset) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, 1));
}
export function Connectors() {
    const { user } = useAuth();
    const { apiFetch } = useApi();
    const [connectors, setConnectors] = useState([]);
    const [token, setToken] = useState(null);
    const [tokenLoading, setTokenLoading] = useState(false);
    const [tokenError, setTokenError] = useState(null);
    const [copyStatus, setCopyStatus] = useState(null);
    const [loginSession, setLoginSession] = useState(null);
    const [loginLoading, setLoginLoading] = useState(null);
    const [loginError, setLoginError] = useState(null);
    const [finishLoading, setFinishLoading] = useState(false);
    const [syncing, setSyncing] = useState(null);
    const [syncStatus, setSyncStatus] = useState(null);
    const [fromMonth, setFromMonth] = useState(() => formatMonth(new Date()));
    const [toMonth, setToMonth] = useState(() => formatMonth(new Date()));
    const refreshConnectors = useCallback(async () => {
        if (!user) {
            return;
        }
        try {
            const data = await fetchConnectors(user.uid);
            setConnectors(data);
        }
        catch {
            setConnectors([]);
        }
    }, [user]);
    useEffect(() => {
        void refreshConnectors();
    }, [refreshConnectors]);
    const statusMap = useMemo(() => {
        const map = new Map();
        connectors.forEach((connector) => map.set(connector.providerId, connector));
        return map;
    }, [connectors]);
    useEffect(() => {
        const handleMessage = (event) => {
            if (event.origin !== window.location.origin) {
                return;
            }
            const data = event.data;
            if (!data || typeof data !== "object") {
                return;
            }
            if (data.type === "aicostledger-login-session") {
                setLoginSession(data.payload);
                setLoginError(null);
                setLoginLoading(null);
                void refreshConnectors();
            }
            else if (data.type === "aicostledger-login-error") {
                setLoginError(data.message || "Unable to start login session");
                setLoginLoading(null);
            }
        };
        window.addEventListener("message", handleMessage);
        return () => {
            window.removeEventListener("message", handleMessage);
        };
    }, [refreshConnectors]);
    const handleGenerateToken = useCallback(async () => {
        setTokenLoading(true);
        setCopyStatus(null);
        setTokenError(null);
        try {
            const response = await apiFetch("/api/token/generate", { method: "POST" });
            setToken(response.token);
        }
        catch (error) {
            setToken(null);
            setTokenError(error.message || "Unable to generate token");
        }
        finally {
            setTokenLoading(false);
        }
    }, [apiFetch]);
    const handleCopy = useCallback(async () => {
        if (!token) {
            return;
        }
        try {
            await navigator.clipboard.writeText(token);
            setCopyStatus("Copied to clipboard");
        }
        catch {
            setCopyStatus("Copy failed");
        }
    }, [token]);
    const handleStartLogin = useCallback((providerId) => {
        setLoginLoading(providerId);
        setLoginError(null);
        setLoginSession(null);
        let popup = null;
        try {
            popup = window.open(`/connectors/login?providerId=${providerId}`, "_blank");
        }
        catch {
            popup = null;
        }
        if (!popup) {
            setLoginError("Popup blocked. Allow popups for this site and try again.");
            setLoginLoading(null);
            return;
        }
        popup.focus();
    }, []);
    const handleFinishLogin = useCallback(async () => {
        if (!loginSession) {
            return;
        }
        setFinishLoading(true);
        try {
            await apiFetch("/collector/connect/finish", {
                method: "POST",
                body: JSON.stringify({
                    sessionId: loginSession.sessionId,
                    sessionKey: loginSession.sessionKey
                })
            });
            setLoginSession(null);
            await refreshConnectors();
        }
        catch (error) {
            setLoginError(error.message || "Unable to save session");
        }
        finally {
            setFinishLoading(false);
        }
    }, [apiFetch, loginSession, refreshConnectors]);
    const handleCancelLogin = useCallback(async () => {
        if (!loginSession) {
            return;
        }
        setFinishLoading(true);
        try {
            await apiFetch("/collector/connect/stop", {
                method: "POST",
                body: JSON.stringify({
                    sessionId: loginSession.sessionId,
                    sessionKey: loginSession.sessionKey
                })
            });
            setLoginSession(null);
        }
        finally {
            setFinishLoading(false);
        }
    }, [apiFetch, loginSession]);
    const applyMonthPreset = useCallback((months) => {
        const end = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
        const start = shiftMonth(end, -(months - 1));
        setFromMonth(formatMonth(start));
        setToMonth(formatMonth(end));
    }, []);
    const applyYearPreset = useCallback((year) => {
        setFromMonth(`${year}-01`);
        setToMonth(`${year}-12`);
    }, []);
    const handleSync = useCallback(async (providerId) => {
        setSyncing(providerId);
        setSyncStatus(null);
        const payload = { providerId };
        if (fromMonth) {
            payload.from = fromMonth;
        }
        if (toMonth) {
            payload.to = toMonth;
        }
        try {
            const response = await apiFetch("/collector/sync", {
                method: "POST",
                body: JSON.stringify(payload)
            });
            setSyncStatus(`Synced ${response.items} items (${response.pdfs} PDFs).`);
            await refreshConnectors();
        }
        catch (error) {
            setSyncStatus(error.message || "Sync failed");
        }
        finally {
            setSyncing(null);
        }
    }, [apiFetch, fromMonth, toMonth, refreshConnectors]);
    const handleSyncAll = useCallback(async () => {
        setSyncing("all");
        setSyncStatus(null);
        const results = [];
        for (const provider of PROVIDERS) {
            const payload = {
                providerId: provider.id
            };
            if (fromMonth) {
                payload.from = fromMonth;
            }
            if (toMonth) {
                payload.to = toMonth;
            }
            try {
                const response = await apiFetch("/collector/sync", {
                    method: "POST",
                    body: JSON.stringify(payload)
                });
                results.push(`${provider.label}: ${response.items} items`);
            }
            catch (error) {
                results.push(`${provider.label}: ${error.message || "Sync failed"}`);
            }
        }
        setSyncStatus(results.join("\n"));
        await refreshConnectors();
        setSyncing(null);
    }, [apiFetch, fromMonth, toMonth, refreshConnectors]);
    const providerLabelById = useMemo(() => {
        const map = new Map();
        PROVIDERS.forEach((provider) => map.set(provider.id, provider.label));
        return map;
    }, []);
    return (_jsxs("div", { className: "space-y-6", children: [_jsxs(Card, { children: [_jsxs(CardHeader, { children: [_jsx(CardTitle, { children: "Cloud collector" }), _jsx(CardDescription, { children: "Start a remote login session, then sync invoices from the billing portals." })] }), _jsxs(CardContent, { className: "space-y-5", children: [loginSession ? (_jsxs("div", { className: "rounded-2xl border border-muted bg-muted/40 px-4 py-3 text-sm", children: [_jsxs("p", { className: "font-semibold", children: ["Login session ready for ", providerLabelById.get(loginSession.providerId), "."] }), _jsxs("p", { className: "mt-1 text-xs text-muted-foreground", children: ["Expires ", new Date(loginSession.expiresAt).toLocaleTimeString(), "."] }), _jsxs("div", { className: "mt-3 flex flex-wrap gap-2", children: [_jsx(Button, { onClick: () => handleStartLogin(loginSession.providerId), children: "Restart login window" }), _jsx(Button, { variant: "outline", onClick: handleFinishLogin, disabled: finishLoading, children: finishLoading ? "Saving..." : "Save session" }), _jsx(Button, { variant: "ghost", onClick: handleCancelLogin, disabled: finishLoading, children: "Cancel" })] })] })) : (_jsx("p", { className: "text-sm text-muted-foreground", children: "Choose a provider below to open a login window." })), loginError ? _jsx("p", { className: "text-sm text-destructive", children: loginError }) : null, _jsxs("div", { className: "grid gap-3", children: [_jsxs("div", { className: "grid gap-3 sm:grid-cols-2", children: [_jsxs("div", { className: "space-y-2", children: [_jsx(Label, { htmlFor: "sync-from", children: "From" }), _jsx(Input, { id: "sync-from", type: "month", value: fromMonth, onChange: (event) => setFromMonth(event.target.value) })] }), _jsxs("div", { className: "space-y-2", children: [_jsx(Label, { htmlFor: "sync-to", children: "To" }), _jsx(Input, { id: "sync-to", type: "month", value: toMonth, onChange: (event) => setToMonth(event.target.value) })] })] }), _jsxs("div", { className: "flex flex-wrap gap-2", children: [_jsx(Button, { variant: "outline", size: "sm", onClick: () => applyMonthPreset(1), children: "Last 1 month" }), _jsx(Button, { variant: "outline", size: "sm", onClick: () => applyMonthPreset(3), children: "Last 3 months" }), _jsx(Button, { variant: "outline", size: "sm", onClick: () => applyMonthPreset(6), children: "Last 6 months" }), _jsx(Button, { variant: "outline", size: "sm", onClick: () => applyYearPreset(2025), children: "2025" }), _jsx(Button, { variant: "ghost", size: "sm", onClick: () => {
                                                    setFromMonth("");
                                                    setToMonth("");
                                                }, children: "Clear range" })] }), _jsxs("div", { className: "flex flex-wrap items-center gap-2", children: [_jsx(Button, { onClick: handleSyncAll, disabled: syncing !== null && syncing !== "all", children: syncing === "all" ? "Syncing all..." : "Sync all providers" }), syncStatus ? (_jsx("p", { className: "text-xs text-muted-foreground whitespace-pre-line", children: syncStatus })) : null] })] })] })] }), _jsxs(Card, { children: [_jsxs(CardHeader, { children: [_jsx(CardTitle, { children: "Provider status" }), _jsx(CardDescription, { children: "Connection and sync status per provider." })] }), _jsx(CardContent, { className: "space-y-3", children: PROVIDERS.map((provider) => {
                            const status = statusMap.get(provider.id);
                            const isFailed = status?.lastStatus === "failed";
                            const isConnected = Boolean(status?.lastStatus === "connected" ||
                                status?.lastStatus === "success" ||
                                status?.sessionUpdatedAt);
                            const badgeVariant = isFailed ? "warning" : isConnected ? "success" : "default";
                            const badgeLabel = isFailed ? "Sync failed" : isConnected ? "Connected" : "Not connected";
                            const isActiveLogin = loginSession?.providerId === provider.id;
                            const isLoginDisabled = Boolean(loginSession && !isActiveLogin);
                            return (_jsxs("div", { className: "flex flex-col gap-3 border-b border-muted pb-3 last:border-none", children: [_jsxs("div", { className: "flex flex-wrap items-center justify-between gap-3", children: [_jsxs("div", { children: [_jsx("p", { className: "text-sm font-semibold", children: provider.label }), _jsx("p", { className: "text-xs text-muted-foreground", children: provider.description })] }), _jsx(Badge, { variant: badgeVariant, children: badgeLabel })] }), _jsxs("div", { className: "flex flex-wrap items-center gap-2", children: [_jsx(Button, { variant: "outline", onClick: () => handleStartLogin(provider.id), disabled: Boolean(loginLoading) || isLoginDisabled, children: loginLoading === provider.id ? "Opening..." : isActiveLogin ? "Re-open login" : "Connect" }), _jsx(Button, { onClick: () => handleSync(provider.id), disabled: syncing !== null && syncing !== provider.id, children: syncing === provider.id ? "Syncing..." : "Sync now" }), isActiveLogin ? (_jsx("span", { className: "text-xs text-muted-foreground", children: "Login session active" })) : null] }), _jsx("p", { className: "text-xs text-muted-foreground", children: status?.lastRunAt
                                            ? `Last run: ${new Date(status.lastRunAt).toLocaleString()}`
                                            : "No runs recorded yet." }), status?.sessionUpdatedAt ? (_jsxs("p", { className: "text-xs text-muted-foreground", children: ["Session saved: ", new Date(status.sessionUpdatedAt).toLocaleString()] })) : null, isFailed && status?.lastError ? (_jsxs("p", { className: "text-xs text-red-500", children: ["Last error: ", status.lastError] })) : null] }, provider.id));
                        }) })] }), _jsxs(Card, { children: [_jsxs(CardHeader, { children: [_jsx(CardTitle, { children: "Local collector (optional)" }), _jsx(CardDescription, { children: "Generate an ingestion token and use it to authenticate the local collector CLI." })] }), _jsxs(CardContent, { className: "space-y-4", children: [_jsxs("div", { className: "flex flex-wrap items-center gap-3", children: [_jsx(Button, { onClick: handleGenerateToken, disabled: tokenLoading, children: tokenLoading ? "Generating..." : "Generate ingestion token" }), token ? (_jsx(Button, { variant: "outline", onClick: handleCopy, children: "Copy token" })) : null, copyStatus ? _jsx("span", { className: "text-sm text-muted-foreground", children: copyStatus }) : null] }), token ? (_jsxs("div", { className: "rounded-2xl border border-muted bg-muted/40 px-4 py-3 text-sm", children: [_jsx("p", { className: "font-mono break-all", children: token }), _jsx("p", { className: "mt-2 text-xs text-muted-foreground", children: "Store this token in your local collector config. You will only see it once." })] })) : null, tokenError ? _jsx("p", { className: "text-sm text-destructive", children: tokenError }) : null, _jsxs("div", { className: "rounded-2xl border border-dashed border-muted p-4 text-sm text-muted-foreground", children: [_jsx("p", { className: "text-sm font-medium text-foreground", children: "Collector quick start" }), _jsx("pre", { className: "mt-2 whitespace-pre-wrap text-xs", children: `pnpm -C packages/collector build
node packages/collector/dist/index.js init
node packages/collector/dist/index.js connect openai_chatgpt
node packages/collector/dist/index.js sync openai_chatgpt --from 2024-01 --to 2024-02` })] })] })] })] }));
}
