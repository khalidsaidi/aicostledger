import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { providerIds, type ProviderId } from "@aicostledger/shared";
import { useApi } from "../lib/api";

type LoginResponse = {
  sessionId: string;
  sessionKey: string;
  providerId: ProviderId;
  devtoolsUrl: string;
  expiresAt: string;
};

type LoginMessage =
  | { type: "aicostledger-login-session"; payload: LoginResponse }
  | { type: "aicostledger-login-error"; message: string };

export function ConnectorLogin() {
  const location = useLocation();
  const { apiFetch } = useApi();
  const [status, setStatus] = useState("Starting login session...");
  const [error, setError] = useState<string | null>(null);

  const providerId = useMemo(() => {
    const params = new URLSearchParams(location.search);
    const value = params.get("providerId");
    return value && providerIds.includes(value as ProviderId) ? (value as ProviderId) : null;
  }, [location.search]);

  useEffect(() => {
    let cancelled = false;

    const notifyOpener = (message: LoginMessage) => {
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
        const response = await apiFetch<LoginResponse>("/collector/connect/start", {
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
      } catch (err) {
        const message = (err as Error).message || "Unable to start login session";
        setError(message);
        notifyOpener({ type: "aicostledger-login-error", message });
      }
    };

    start();

    return () => {
      cancelled = true;
    };
  }, [apiFetch, providerId]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
      <div className="max-w-md text-center">
        <p className="text-sm font-semibold">AICostLedger</p>
        <p className="mt-2 text-sm text-muted-foreground">{status}</p>
        {error ? <p className="mt-4 text-sm text-red-500">{error}</p> : null}
        <p className="mt-4 text-xs text-muted-foreground">
          This window will redirect to the provider login when ready.
        </p>
      </div>
    </div>
  );
}
