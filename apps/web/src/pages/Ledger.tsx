import { useCallback, useEffect, useMemo, useState } from "react";
import type { LedgerItem, ProviderId } from "@aicostledger/shared";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "../components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { useApi } from "../lib/api";
import { useAuth } from "../lib/auth";
import { fetchLedgerItems } from "../lib/data";
import { formatCurrency, formatDate } from "../lib/date";

const PROVIDER_OPTIONS: Array<{ value: ProviderId; label: string }> = [
  { value: "openai_chatgpt", label: "OpenAI ChatGPT" },
  { value: "openai_api", label: "OpenAI API" },
  { value: "anthropic_claude", label: "Claude (subscription)" },
  { value: "anthropic_api", label: "Anthropic API" },
  { value: "cursor", label: "Cursor" }
];

export function Ledger() {
  const { user } = useAuth();
  const { apiDownload, apiFetch } = useApi();
  const [items, setItems] = useState<LedgerItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [providerFilter, setProviderFilter] = useState<string>("all");
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");
  const [search, setSearch] = useState<string>("");

  useEffect(() => {
    if (!user) {
      return;
    }
    setLoading(true);
    fetchLedgerItems(user.uid)
      .then((data) => setItems(data))
      .finally(() => setLoading(false));
  }, [user]);

  const filteredItems = useMemo(() => {
    const lowerSearch = search.trim().toLowerCase();
    return items.filter((item) => {
      if (providerFilter !== "all" && item.providerId !== providerFilter) {
        return false;
      }
      if (fromDate) {
        const from = new Date(`${fromDate}T00:00:00Z`);
        if (new Date(item.occurredAt) < from) {
          return false;
        }
      }
      if (toDate) {
        const to = new Date(`${toDate}T23:59:59Z`);
        if (new Date(item.occurredAt) > to) {
          return false;
        }
      }
      if (lowerSearch) {
        const haystack = [item.description, item.invoiceNumber ?? "", item.providerId]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(lowerSearch)) {
          return false;
        }
      }
      return true;
    });
  }, [items, providerFilter, fromDate, toDate, search]);

  const totalsByCurrency = useMemo(() => {
    const totals = new Map<string, number>();
    for (const item of filteredItems) {
      totals.set(item.currency, (totals.get(item.currency) ?? 0) + item.amountCents);
    }
    return totals;
  }, [filteredItems]);

  const totalsByProvider = useMemo(() => {
    const totals = new Map<string, number>();
    for (const item of filteredItems) {
      totals.set(item.providerId, (totals.get(item.providerId) ?? 0) + item.amountCents);
    }
    return totals;
  }, [filteredItems]);
  const singleCurrency = totalsByCurrency.size <= 1;

  const downloadCsv = useCallback(async () => {
    const params = new URLSearchParams();
    if (providerFilter !== "all") {
      params.set("providerId", providerFilter);
    }
    if (fromDate) {
      params.set("from", new Date(`${fromDate}T00:00:00Z`).toISOString());
    }
    if (toDate) {
      params.set("to", new Date(`${toDate}T23:59:59Z`).toISOString());
    }
    const blob = await apiDownload(`/api/export.csv?${params.toString()}`);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `aicostledger-${formatDate(new Date())}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }, [apiDownload, providerFilter, fromDate, toDate]);

  const openReceipt = useCallback(
    async (item: LedgerItem) => {
      if (item.invoiceUrl) {
        window.open(item.invoiceUrl, "_blank", "noopener,noreferrer");
        return;
      }
      if (!item.pdfStoragePath) {
        return;
      }
      const response = await apiFetch<{ url: string }>(`/api/receipts/${item.id}/url`);
      window.open(response.url, "_blank", "noopener,noreferrer");
    },
    [apiFetch]
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Ledger filters</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-4">
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground">Provider</label>
            <select
              className="h-10 w-full rounded-2xl border border-input bg-background px-3 text-sm"
              value={providerFilter}
              onChange={(event) => setProviderFilter(event.target.value)}
            >
              <option value="all">All providers</option>
              {PROVIDER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground">From</label>
            <Input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
          </div>
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground">To</label>
            <Input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} />
          </div>
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground">Search</label>
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="invoice, provider" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <CardTitle>Ledger entries</CardTitle>
          <Button onClick={downloadCsv} disabled={loading}>
            Download CSV
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-3">
            {totalsByCurrency.size ? (
              Array.from(totalsByCurrency.entries()).map(([currency, amount]) => (
                <Badge key={currency} variant="success">
                  {formatCurrency(amount, currency)}
                </Badge>
              ))
            ) : (
              <span className="text-sm text-muted-foreground">No totals yet.</span>
            )}
          </div>
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            {singleCurrency ? (
              Array.from(totalsByProvider.entries()).map(([provider, amount]) => (
                <span key={provider}>
                  {provider}: {formatCurrency(amount, Array.from(totalsByCurrency.keys())[0] ?? "USD")}
                </span>
              ))
            ) : (
              <span>Provider breakdown hidden for mixed currencies.</span>
            )}
          </div>
          <div className="rounded-2xl border border-muted">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Receipt</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-sm text-muted-foreground">
                      Loading ledger entries...
                    </TableCell>
                  </TableRow>
                ) : filteredItems.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-sm text-muted-foreground">
                      No ledger entries match these filters.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredItems.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(item.occurredAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-xs font-medium">{item.providerId}</TableCell>
                      <TableCell className="text-xs">{item.description}</TableCell>
                      <TableCell className="text-xs">
                        {formatCurrency(item.amountCents, item.currency)}
                      </TableCell>
                      <TableCell className="text-xs">{item.invoiceNumber ?? "—"}</TableCell>
                      <TableCell>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={!item.invoiceUrl && !item.pdfStoragePath}
                          onClick={() => openReceipt(item)}
                        >
                          Receipt
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
