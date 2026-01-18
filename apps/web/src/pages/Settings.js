import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useState } from "react";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { useApi } from "../lib/api";
export function Settings() {
    const { apiFetch } = useApi();
    const [token, setToken] = useState(null);
    const [status, setStatus] = useState(null);
    const [loadingToken, setLoadingToken] = useState(false);
    const [loadingDelete, setLoadingDelete] = useState(false);
    const rotateToken = useCallback(async () => {
        setLoadingToken(true);
        setStatus(null);
        try {
            const response = await apiFetch("/api/token/generate", { method: "POST" });
            setToken(response.token);
            setStatus("New ingestion token generated.");
        }
        finally {
            setLoadingToken(false);
        }
    }, [apiFetch]);
    const deleteData = useCallback(async () => {
        const confirmed = window.confirm("Delete all ledger data and receipts? This cannot be undone.");
        if (!confirmed) {
            return;
        }
        setLoadingDelete(true);
        setStatus(null);
        try {
            const response = await apiFetch("/api/data/delete", { method: "POST" });
            if (response.ok) {
                setStatus("All data deleted.");
            }
            else {
                setStatus("Delete failed.");
            }
        }
        finally {
            setLoadingDelete(false);
        }
    }, [apiFetch]);
    return (_jsxs("div", { className: "space-y-6", children: [_jsxs(Card, { children: [_jsxs(CardHeader, { children: [_jsx(CardTitle, { children: "Ingestion token" }), _jsx(CardDescription, { children: "Rotate the token used by your local collector." })] }), _jsxs(CardContent, { className: "space-y-4", children: [_jsx(Button, { onClick: rotateToken, disabled: loadingToken, children: loadingToken ? "Rotating..." : "Rotate ingestion token" }), token ? (_jsxs("div", { className: "rounded-2xl border border-muted bg-muted/40 px-4 py-3 text-sm", children: [_jsx("p", { className: "font-mono break-all", children: token }), _jsx("p", { className: "mt-2 text-xs text-muted-foreground", children: "Update your collector config." })] })) : null, status ? _jsx("p", { className: "text-sm text-muted-foreground", children: status }) : null] })] }), _jsxs(Card, { children: [_jsxs(CardHeader, { children: [_jsx(CardTitle, { children: "Delete data" }), _jsx(CardDescription, { children: "Remove ledger items, run logs, and receipts." })] }), _jsxs(CardContent, { className: "space-y-4", children: [_jsx(Button, { variant: "destructive", onClick: deleteData, disabled: loadingDelete, children: loadingDelete ? "Deleting..." : "Delete all data" }), status ? _jsx("p", { className: "text-sm text-muted-foreground", children: status }) : null] })] })] }));
}
