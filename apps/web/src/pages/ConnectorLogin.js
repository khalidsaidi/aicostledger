import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { providerIds } from "@aicostledger/shared";
import { useApi } from "../lib/api";
export function ConnectorLogin() {
    const location = useLocation();
    const { apiFetch } = useApi();
    const [status, setStatus] = useState("Starting login session...");
    const [error, setError] = useState(null);
    const providerId = useMemo(() => {
        const params = new URLSearchParams(location.search);
        const value = params.get("providerId");
        return value && providerIds.includes(value) ? value : null;
    }, [location.search]);
    useEffect(() => {
        let cancelled = false;
        const notifyOpener = (message) => {
            if (window.opener && window.opener !== window) {
                window.opener.postMessage(message, window.location.origin);
            }
        };
        const start = async () => {
            if (!providerId) {
                const message = "Missing or invalid provider.";
                setError(message);
                notifyOpener({ type: "aicostledger-login-error", message });
                return;
            }
            try {
                setStatus(`Starting ${providerId} session...`);
                const response = await apiFetch("/collector/connect/start", {
                    method: "POST",
                    body: JSON.stringify({ providerId })
                });
                if (providerId === "manus") {
                    await apiFetch("/collector/connect/navigate", {
                        method: "POST",
                        body: JSON.stringify({
                            sessionId: response.sessionId,
                            sessionKey: response.sessionKey,
                            url: "https://manus.im/app/billing"
                        })
                    }).catch(() => undefined);
                }
                if (cancelled) {
                    return;
                }
                notifyOpener({ type: "aicostledger-login-session", payload: response });
                setStatus("Launching login window...");
                window.location.href = response.devtoolsUrl;
            }
            catch (err) {
                const message = err.message || "Unable to start login session";
                setError(message);
                notifyOpener({ type: "aicostledger-login-error", message });
            }
        };
        start();
        return () => {
            cancelled = true;
        };
    }, [apiFetch, providerId]);
    return (_jsx("div", { className: "flex min-h-screen items-center justify-center bg-background p-6 text-foreground", children: _jsxs("div", { className: "max-w-md text-center", children: [_jsx("p", { className: "text-sm font-semibold", children: "AICostLedger" }), _jsx("p", { className: "mt-2 text-sm text-muted-foreground", children: status }), error ? _jsx("p", { className: "mt-4 text-sm text-red-500", children: error }) : null, _jsx("p", { className: "mt-4 text-xs text-muted-foreground", children: "This window will redirect to the provider login when ready." })] }) }));
}
