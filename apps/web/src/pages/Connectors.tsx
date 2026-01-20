import { useCallback, useEffect, useMemo, useState } from "react";
import type { ProviderId } from "@aicostledger/shared";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { useApi } from "../lib/api";
import { useAuth } from "../lib/auth";
import { fetchConnectors } from "../lib/data";

const PROVIDERS: Array<{ id: ProviderId; label: string; description: string }> = [
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

type ConnectorStatus = {
  providerId: ProviderId;
  lastRunAt?: string;
  lastStatus?: string;
  sessionUpdatedAt?: string;
  lastError?: string;
};

type TokenResponse = {
  token: string;
};

type LoginResponse = {
  sessionId: string;
  sessionKey: string;
  providerId: ProviderId;
  devtoolsUrl: string;
  expiresAt: string;
};

type SyncResponse = {
  runId: string;
  items: number;
  pdfs: number;
};

type SyncTarget = ProviderId | "all";

function formatMonth(date: Date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function shiftMonth(date: Date, offset: number) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, 1));
}

export function Connectors() {
  const { user } = useAuth();
  const { apiFetch } = useApi();
  const [connectors, setConnectors] = useState<ConnectorStatus[]>([]);
  const [token, setToken] = useState<string | null>(null);
  const [tokenLoading, setTokenLoading] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [loginSession, setLoginSession] = useState<LoginResponse | null>(null);
  const [loginLoading, setLoginLoading] = useState<ProviderId | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [finishLoading, setFinishLoading] = useState(false);
  const [syncing, setSyncing] = useState<SyncTarget | null>(null);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [fromMonth, setFromMonth] = useState(() => formatMonth(new Date()));
  const [toMonth, setToMonth] = useState(() => formatMonth(new Date()));

  const refreshConnectors = useCallback(async () => {
    if (!user) {
      return;
    }
    try {
      const data = await fetchConnectors(user.uid);
      setConnectors(data);
    } catch {
      setConnectors([]);
    }
  }, [user]);

  useEffect(() => {
    void refreshConnectors();
  }, [refreshConnectors]);

  const statusMap = useMemo(() => {
    const map = new Map<ProviderId, ConnectorStatus>();
    connectors.forEach((connector) => map.set(connector.providerId, connector));
    return map;
  }, [connectors]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) {
        return;
      }
      const data = event.data as
        | { type: "aicostledger-login-session"; payload: LoginResponse }
        | { type: "aicostledger-login-error"; message: string }
        | undefined;
      if (!data || typeof data !== "object") {
        return;
      }
      if (data.type === "aicostledger-login-session") {
        setLoginSession(data.payload);
        setLoginError(null);
        setLoginLoading(null);
        void refreshConnectors();
      } else if (data.type === "aicostledger-login-error") {
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
      const response = await apiFetch<TokenResponse>("/api/token/generate", { method: "POST" });
      setToken(response.token);
    } catch (error) {
      setToken(null);
      setTokenError((error as Error).message || "Unable to generate token");
    } finally {
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
    } catch {
      setCopyStatus("Copy failed");
    }
  }, [token]);

  const handleStartLogin = useCallback(
    (providerId: ProviderId) => {
      setLoginLoading(providerId);
      setLoginError(null);
      setLoginSession(null);
      let popup: Window | null = null;
      try {
        popup = window.open(`/connectors/login?providerId=${providerId}`, "_blank");
      } catch {
        popup = null;
      }
      if (!popup) {
        setLoginError("Popup blocked. Allow popups for this site and try again.");
        setLoginLoading(null);
        return;
      }
      popup.focus();
    },
    []
  );

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
    } catch (error) {
      setLoginError((error as Error).message || "Unable to save session");
    } finally {
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
    } finally {
      setFinishLoading(false);
    }
  }, [apiFetch, loginSession]);

  const applyMonthPreset = useCallback((months: number) => {
    const end = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
    const start = shiftMonth(end, -(months - 1));
    setFromMonth(formatMonth(start));
    setToMonth(formatMonth(end));
  }, []);

  const applyYearPreset = useCallback((year: number) => {
    setFromMonth(`${year}-01`);
    setToMonth(`${year}-12`);
  }, []);

  const handleSync = useCallback(
    async (providerId: ProviderId) => {
      setSyncing(providerId);
      setSyncStatus(null);
      const payload: { providerId: ProviderId; from?: string; to?: string } = { providerId };
      if (fromMonth) {
        payload.from = fromMonth;
      }
      if (toMonth) {
        payload.to = toMonth;
      }
      try {
        const response = await apiFetch<SyncResponse>("/collector/sync", {
          method: "POST",
          body: JSON.stringify(payload)
        });
        setSyncStatus(`Synced ${response.items} items (${response.pdfs} PDFs).`);
        await refreshConnectors();
      } catch (error) {
        setSyncStatus((error as Error).message || "Sync failed");
      } finally {
        setSyncing(null);
      }
    },
    [apiFetch, fromMonth, toMonth, refreshConnectors]
  );

  const handleSyncAll = useCallback(async () => {
    setSyncing("all");
    setSyncStatus(null);
    const results: string[] = [];

    for (const provider of PROVIDERS) {
      const payload: { providerId: ProviderId; from?: string; to?: string } = {
        providerId: provider.id
      };
      if (fromMonth) {
        payload.from = fromMonth;
      }
      if (toMonth) {
        payload.to = toMonth;
      }
      try {
        const response = await apiFetch<SyncResponse>("/collector/sync", {
          method: "POST",
          body: JSON.stringify(payload)
        });
        results.push(`${provider.label}: ${response.items} items`);
      } catch (error) {
        results.push(`${provider.label}: ${(error as Error).message || "Sync failed"}`);
      }
    }

    setSyncStatus(results.join("\n"));
    await refreshConnectors();
    setSyncing(null);
  }, [apiFetch, fromMonth, toMonth, refreshConnectors]);

  const providerLabelById = useMemo(() => {
    const map = new Map<ProviderId, string>();
    PROVIDERS.forEach((provider) => map.set(provider.id, provider.label));
    return map;
  }, []);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Cloud collector</CardTitle>
          <CardDescription>
            Start a remote login session, then sync invoices from the billing portals.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {loginSession ? (
            <div className="rounded-2xl border border-muted bg-muted/40 px-4 py-3 text-sm">
              <p className="font-semibold">
                Login session ready for {providerLabelById.get(loginSession.providerId)}.
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Expires {new Date(loginSession.expiresAt).toLocaleTimeString()}.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  onClick={() => handleStartLogin(loginSession.providerId)}
                >
                  Restart login window
                </Button>
                <Button variant="outline" onClick={handleFinishLogin} disabled={finishLoading}>
                  {finishLoading ? "Saving..." : "Save session"}
                </Button>
                <Button variant="ghost" onClick={handleCancelLogin} disabled={finishLoading}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Choose a provider below to open a login window.
            </p>
          )}
          {loginError ? <p className="text-sm text-destructive">{loginError}</p> : null}
          <div className="grid gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="sync-from">From</Label>
                <Input
                  id="sync-from"
                  type="month"
                  value={fromMonth}
                  onChange={(event) => setFromMonth(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sync-to">To</Label>
                <Input
                  id="sync-to"
                  type="month"
                  value={toMonth}
                  onChange={(event) => setToMonth(event.target.value)}
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => applyMonthPreset(1)}>
                Last 1 month
              </Button>
              <Button variant="outline" size="sm" onClick={() => applyMonthPreset(3)}>
                Last 3 months
              </Button>
              <Button variant="outline" size="sm" onClick={() => applyMonthPreset(6)}>
                Last 6 months
              </Button>
              <Button variant="outline" size="sm" onClick={() => applyYearPreset(2025)}>
                2025
              </Button>
              <Button variant="ghost" size="sm" onClick={() => {
                setFromMonth("");
                setToMonth("");
              }}>
                Clear range
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={handleSyncAll} disabled={syncing !== null && syncing !== "all"}>
                {syncing === "all" ? "Syncing all..." : "Sync all providers"}
              </Button>
              {syncStatus ? (
                <p className="text-xs text-muted-foreground whitespace-pre-line">{syncStatus}</p>
              ) : null}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Provider status</CardTitle>
          <CardDescription>Connection and sync status per provider.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {PROVIDERS.map((provider) => {
            const status = statusMap.get(provider.id);
            const isFailed = status?.lastStatus === "failed";
            const isConnected = Boolean(
              status?.lastStatus === "connected" ||
                status?.lastStatus === "success" ||
                status?.sessionUpdatedAt
            );
            const badgeVariant = isFailed ? "warning" : isConnected ? "success" : "default";
            const badgeLabel = isFailed ? "Sync failed" : isConnected ? "Connected" : "Not connected";
            const isActiveLogin = loginSession?.providerId === provider.id;
            const isLoginDisabled = Boolean(loginSession && !isActiveLogin);
            return (
              <div key={provider.id} className="flex flex-col gap-3 border-b border-muted pb-3 last:border-none">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">{provider.label}</p>
                    <p className="text-xs text-muted-foreground">{provider.description}</p>
                  </div>
                  <Badge variant={badgeVariant}>
                    {badgeLabel}
                  </Badge>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    onClick={() => handleStartLogin(provider.id)}
                    disabled={Boolean(loginLoading) || isLoginDisabled}
                  >
                    {loginLoading === provider.id ? "Opening..." : isActiveLogin ? "Re-open login" : "Connect"}
                  </Button>
                  <Button
                    onClick={() => handleSync(provider.id)}
                    disabled={syncing !== null && syncing !== provider.id}
                  >
                    {syncing === provider.id ? "Syncing..." : "Sync now"}
                  </Button>
                  {isActiveLogin ? (
                    <span className="text-xs text-muted-foreground">Login session active</span>
                  ) : null}
                </div>
                <p className="text-xs text-muted-foreground">
                  {status?.lastRunAt
                    ? `Last run: ${new Date(status.lastRunAt).toLocaleString()}`
                    : "No runs recorded yet."}
                </p>
                {status?.sessionUpdatedAt ? (
                  <p className="text-xs text-muted-foreground">
                    Session saved: {new Date(status.sessionUpdatedAt).toLocaleString()}
                  </p>
                ) : null}
                {isFailed && status?.lastError ? (
                  <p className="text-xs text-red-500">Last error: {status.lastError}</p>
                ) : null}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Local collector (optional)</CardTitle>
          <CardDescription>
            Generate an ingestion token and use it to authenticate the local collector CLI.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={handleGenerateToken} disabled={tokenLoading}>
              {tokenLoading ? "Generating..." : "Generate ingestion token"}
            </Button>
            {token ? (
              <Button variant="outline" onClick={handleCopy}>
                Copy token
              </Button>
            ) : null}
            {copyStatus ? <span className="text-sm text-muted-foreground">{copyStatus}</span> : null}
          </div>
          {token ? (
            <div className="rounded-2xl border border-muted bg-muted/40 px-4 py-3 text-sm">
              <p className="font-mono break-all">{token}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                Store this token in your local collector config. You will only see it once.
              </p>
            </div>
          ) : null}
          {tokenError ? <p className="text-sm text-destructive">{tokenError}</p> : null}
          <div className="rounded-2xl border border-dashed border-muted p-4 text-sm text-muted-foreground">
            <p className="text-sm font-medium text-foreground">Collector quick start</p>
            <pre className="mt-2 whitespace-pre-wrap text-xs">
{`pnpm -C packages/collector build
node packages/collector/dist/index.js init
node packages/collector/dist/index.js connect openai_chatgpt
node packages/collector/dist/index.js sync openai_chatgpt --from 2024-01 --to 2024-02`}
            </pre>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
