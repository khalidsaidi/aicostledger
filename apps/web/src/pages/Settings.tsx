import { useCallback, useState } from "react";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { useApi } from "../lib/api";

type TokenResponse = {
  token: string;
};

type DeleteResponse = {
  ok: boolean;
};

export function Settings() {
  const { apiFetch } = useApi();
  const [token, setToken] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [loadingToken, setLoadingToken] = useState(false);
  const [loadingDelete, setLoadingDelete] = useState(false);

  const rotateToken = useCallback(async () => {
    setLoadingToken(true);
    setStatus(null);
    try {
      const response = await apiFetch<TokenResponse>("/api/token/generate", { method: "POST" });
      setToken(response.token);
      setStatus("New ingestion token generated.");
    } finally {
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
      const response = await apiFetch<DeleteResponse>("/api/data/delete", { method: "POST" });
      if (response.ok) {
        setStatus("All data deleted.");
      } else {
        setStatus("Delete failed.");
      }
    } finally {
      setLoadingDelete(false);
    }
  }, [apiFetch]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Ingestion token</CardTitle>
          <CardDescription>Rotate the token used by your local collector.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button onClick={rotateToken} disabled={loadingToken}>
            {loadingToken ? "Rotating..." : "Rotate ingestion token"}
          </Button>
          {token ? (
            <div className="rounded-2xl border border-muted bg-muted/40 px-4 py-3 text-sm">
              <p className="font-mono break-all">{token}</p>
              <p className="mt-2 text-xs text-muted-foreground">Update your collector config.</p>
            </div>
          ) : null}
          {status ? <p className="text-sm text-muted-foreground">{status}</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Delete data</CardTitle>
          <CardDescription>Remove ledger items, run logs, and receipts.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button variant="destructive" onClick={deleteData} disabled={loadingDelete}>
            {loadingDelete ? "Deleting..." : "Delete all data"}
          </Button>
          {status ? <p className="text-sm text-muted-foreground">{status}</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}
