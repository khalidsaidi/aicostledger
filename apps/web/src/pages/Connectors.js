import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
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
    }
];
export function Connectors() {
    const { user } = useAuth();
    const { apiFetch } = useApi();
    const [connectors, setConnectors] = useState([]);
    const [token, setToken] = useState(null);
    const [tokenLoading, setTokenLoading] = useState(false);
    const [copyStatus, setCopyStatus] = useState(null);
    useEffect(() => {
        if (!user) {
            return;
        }
        fetchConnectors(user.uid)
            .then((data) => setConnectors(data))
            .catch(() => setConnectors([]));
    }, [user]);
    const statusMap = useMemo(() => {
        const map = new Map();
        connectors.forEach((connector) => map.set(connector.providerId, connector));
        return map;
    }, [connectors]);
    const handleGenerateToken = useCallback(async () => {
        setTokenLoading(true);
        setCopyStatus(null);
        try {
            const response = await apiFetch("/api/token/generate", { method: "POST" });
            setToken(response.token);
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
    return (_jsxs("div", { className: "space-y-6", children: [_jsxs(Card, { children: [_jsxs(CardHeader, { children: [_jsx(CardTitle, { children: "Collector setup" }), _jsx(CardDescription, { children: "Generate an ingestion token and use it to authenticate the local collector CLI." })] }), _jsxs(CardContent, { className: "space-y-4", children: [_jsxs("div", { className: "flex flex-wrap items-center gap-3", children: [_jsx(Button, { onClick: handleGenerateToken, disabled: tokenLoading, children: tokenLoading ? "Generating..." : "Generate ingestion token" }), token ? (_jsx(Button, { variant: "outline", onClick: handleCopy, children: "Copy token" })) : null, copyStatus ? _jsx("span", { className: "text-sm text-muted-foreground", children: copyStatus }) : null] }), token ? (_jsxs("div", { className: "rounded-2xl border border-muted bg-muted/40 px-4 py-3 text-sm", children: [_jsx("p", { className: "font-mono break-all", children: token }), _jsx("p", { className: "mt-2 text-xs text-muted-foreground", children: "Store this token in your local collector config. You will only see it once." })] })) : null, _jsxs("div", { className: "rounded-2xl border border-dashed border-muted p-4 text-sm text-muted-foreground", children: [_jsx("p", { className: "text-sm font-medium text-foreground", children: "Collector quick start" }), _jsx("pre", { className: "mt-2 whitespace-pre-wrap text-xs", children: `pnpm -C packages/collector build
node packages/collector/dist/index.js init
node packages/collector/dist/index.js connect openai_chatgpt
node packages/collector/dist/index.js sync openai_chatgpt --from 2024-01 --to 2024-02` })] })] })] }), _jsxs(Card, { children: [_jsxs(CardHeader, { children: [_jsx(CardTitle, { children: "Provider status" }), _jsx(CardDescription, { children: "Last successful collector sync per provider." })] }), _jsx(CardContent, { className: "space-y-3", children: PROVIDERS.map((provider) => {
                            const status = statusMap.get(provider.id);
                            const isConnected = Boolean(status?.lastRunAt);
                            return (_jsxs("div", { className: "flex flex-col gap-2 border-b border-muted pb-3 last:border-none", children: [_jsxs("div", { className: "flex flex-wrap items-center justify-between gap-3", children: [_jsxs("div", { children: [_jsx("p", { className: "text-sm font-semibold", children: provider.label }), _jsx("p", { className: "text-xs text-muted-foreground", children: provider.description })] }), _jsx(Badge, { variant: isConnected ? "success" : "warning", children: isConnected ? "Connected" : "Not connected" })] }), _jsx("p", { className: "text-xs text-muted-foreground", children: status?.lastRunAt
                                            ? `Last run: ${new Date(status.lastRunAt).toLocaleString()}`
                                            : "No runs recorded yet." })] }, provider.id));
                        }) })] })] }));
}
