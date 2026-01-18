import { useCallback, useEffect, useMemo, useState } from "react";
import type { ProviderId } from "@aicostledger/shared";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
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
  }
];

type ConnectorStatus = {
  providerId: ProviderId;
  lastRunAt?: string;
  lastStatus?: string;
};

type TokenResponse = {
  token: string;
};

export function Connectors() {
  const { user } = useAuth();
  const { apiFetch } = useApi();
  const [connectors, setConnectors] = useState<ConnectorStatus[]>([]);
  const [token, setToken] = useState<string | null>(null);
  const [tokenLoading, setTokenLoading] = useState(false);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      return;
    }
    fetchConnectors(user.uid)
      .then((data) => setConnectors(data))
      .catch(() => setConnectors([]));
  }, [user]);

  const statusMap = useMemo(() => {
    const map = new Map<ProviderId, ConnectorStatus>();
    connectors.forEach((connector) => map.set(connector.providerId, connector));
    return map;
  }, [connectors]);

  const handleGenerateToken = useCallback(async () => {
    setTokenLoading(true);
    setCopyStatus(null);
    try {
      const response = await apiFetch<TokenResponse>("/api/token/generate", { method: "POST" });
      setToken(response.token);
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

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Collector setup</CardTitle>
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

      <Card>
        <CardHeader>
          <CardTitle>Provider status</CardTitle>
          <CardDescription>Last successful collector sync per provider.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {PROVIDERS.map((provider) => {
            const status = statusMap.get(provider.id);
            const isConnected = Boolean(status?.lastRunAt);
            return (
              <div key={provider.id} className="flex flex-col gap-2 border-b border-muted pb-3 last:border-none">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">{provider.label}</p>
                    <p className="text-xs text-muted-foreground">{provider.description}</p>
                  </div>
                  <Badge variant={isConnected ? "success" : "warning"}>
                    {isConnected ? "Connected" : "Not connected"}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {status?.lastRunAt
                    ? `Last run: ${new Date(status.lastRunAt).toLocaleString()}`
                    : "No runs recorded yet."}
                </p>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
