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
  { value: "cursor", label: "Cursor" },
  { value: "manus", label: "Manus" }
];

type BreakdownMode = "month" | "provider" | "month-provider";

type BreakdownRow = {
  key: string;
  label: string;
  totals: Map<string, number>;
  sortKey: number;
  secondaryKey?: string;
};

const formatMonthLabel = (year: number, monthIndex: number) =>
  new Date(Date.UTC(year, monthIndex, 1)).toLocaleString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC"
  });

type MonthlyBreakdownRow = {
  month: string;
  totals: Map<string, number>;
  sortKey: number;
};

const zeroDecimalCurrencies = new Set(["JPY", "KRW"]);

const formatAmountValue = (amountCents: number, currency: string) => {
  const zeroDecimal = zeroDecimalCurrencies.has(currency.toUpperCase());
  return zeroDecimal ? `${amountCents}` : (amountCents / 100).toFixed(2);
};

const csvEscape = (value: string) => {
  if (value.includes(",") || value.includes("\"") || value.includes("\n")) {
    return `"${value.replace(/"/g, "\"\"")}"`;
  }
  return value;
};

const parseDateParam = (value: string | null) => {
  if (!value) {
    return "";
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  return formatDate(parsed);
};

const allowedBreakdownModes: BreakdownMode[] = ["month", "provider", "month-provider"];
const allowedQuickRanges = new Set(["last-1", "last-3", "last-6", "last-12"]);

export function Ledger() {
  const { user } = useAuth();
  const { apiDownload, apiFetch } = useApi();
  const [items, setItems] = useState<LedgerItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [providerFilter, setProviderFilter] = useState<string>("all");
  const [yearFilter, setYearFilter] = useState<string>("all");
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");
  const [search, setSearch] = useState<string>("");
  const [quickRange, setQuickRange] = useState<string>("");
  const [breakdownMode, setBreakdownMode] = useState<BreakdownMode>("month");
  const [filtersInitialized, setFiltersInitialized] = useState(false);

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

  const availableYears = useMemo(() => {
    const years = new Set<number>();
    for (const item of items) {
      years.add(new Date(item.occurredAt).getUTCFullYear());
    }
    const currentYear = new Date().getUTCFullYear();
    years.add(currentYear);
    return Array.from(years).sort((a, b) => b - a);
  }, [items]);

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

  const providerLabels = useMemo(() => {
    return new Map(PROVIDER_OPTIONS.map((option) => [option.value, option.label]));
  }, []);
  const providerValues = useMemo(() => {
    return new Set(PROVIDER_OPTIONS.map((option) => option.value));
  }, []);

  const breakdownRows = useMemo<BreakdownRow[]>(() => {
    const rows = new Map<string, BreakdownRow>();

    for (const item of filteredItems) {
      const occurred = new Date(item.occurredAt);
      const year = occurred.getUTCFullYear();
      const monthIndex = occurred.getUTCMonth();
      const monthKey = `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
      const monthLabel = formatMonthLabel(year, monthIndex);
      const providerLabel = providerLabels.get(item.providerId) ?? item.providerId;

      let key = "";
      let label = "";
      let sortKey = 0;
      let secondaryKey: string | undefined;

      if (breakdownMode === "month") {
        key = monthKey;
        label = monthLabel;
        sortKey = year * 100 + monthIndex + 1;
      } else if (breakdownMode === "provider") {
        key = item.providerId;
        label = providerLabel;
        sortKey = 0;
        secondaryKey = providerLabel;
      } else {
        key = `${monthKey}-${item.providerId}`;
        label = `${monthLabel} - ${providerLabel}`;
        sortKey = year * 100 + monthIndex + 1;
        secondaryKey = providerLabel;
      }

      const row = rows.get(key) ?? {
        key,
        label,
        totals: new Map<string, number>(),
        sortKey,
        secondaryKey
      };

      row.totals.set(item.currency, (row.totals.get(item.currency) ?? 0) + item.amountCents);
      rows.set(key, row);
    }

    const values = Array.from(rows.values());
    if (breakdownMode === "provider") {
      return values.sort((a, b) => a.label.localeCompare(b.label));
    }
    return values.sort((a, b) => {
      if (b.sortKey !== a.sortKey) {
        return b.sortKey - a.sortKey;
      }
      return (a.secondaryKey ?? "").localeCompare(b.secondaryKey ?? "");
    });
  }, [filteredItems, breakdownMode, providerLabels]);

  const monthlyBreakdownRows = useMemo<MonthlyBreakdownRow[]>(() => {
    const rows = new Map<string, MonthlyBreakdownRow>();

    for (const item of filteredItems) {
      const occurred = new Date(item.occurredAt);
      const year = occurred.getUTCFullYear();
      const monthIndex = occurred.getUTCMonth();
      const monthKey = `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
      const sortKey = year * 100 + monthIndex + 1;
      const row = rows.get(monthKey) ?? {
        month: monthKey,
        totals: new Map<string, number>(),
        sortKey
      };
      row.totals.set(item.currency, (row.totals.get(item.currency) ?? 0) + item.amountCents);
      rows.set(monthKey, row);
    }

    return Array.from(rows.values()).sort((a, b) => a.sortKey - b.sortKey);
  }, [filteredItems]);

  const applyRange = useCallback((start: Date, end: Date) => {
    setFromDate(formatDate(start));
    setToDate(formatDate(end));
  }, []);

  const handleQuickRange = useCallback(
    (months: number) => {
      const now = new Date();
      // Use full calendar months ending last month (e.g. "last 1 month" = previous month).
      const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
      const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - (months - 1), 1));
      applyRange(start, end);
      setYearFilter("all");
      setQuickRange(`last-${months}`);
    },
    [applyRange]
  );

  const handleYearChange = useCallback((value: string) => {
    setYearFilter(value);
    setQuickRange("");
    if (value === "all") {
      setFromDate("");
      setToDate("");
      return;
    }
    const year = Number(value);
    if (Number.isNaN(year)) {
      return;
    }
    const start = new Date(Date.UTC(year, 0, 1));
    const end = new Date(Date.UTC(year, 11, 31));
    applyRange(start, end);
  }, [applyRange]);

  const handleFromDateChange = useCallback((value: string) => {
    setFromDate(value);
    setYearFilter("all");
    setQuickRange("");
  }, []);

  const handleToDateChange = useCallback((value: string) => {
    setToDate(value);
    setYearFilter("all");
    setQuickRange("");
  }, []);

  useEffect(() => {
    if (filtersInitialized) {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const providerParam = params.get("provider");
    if (providerParam && providerValues.has(providerParam as ProviderId)) {
      setProviderFilter(providerParam);
    }

    const searchParam = params.get("search");
    if (searchParam) {
      setSearch(searchParam);
    }

    const groupParam = params.get("group");
    if (groupParam && allowedBreakdownModes.includes(groupParam as BreakdownMode)) {
      setBreakdownMode(groupParam as BreakdownMode);
    }

    const fromParam = parseDateParam(params.get("from"));
    const toParam = parseDateParam(params.get("to"));
    const yearParam = params.get("year");
    const quickParam = params.get("quick");

    if (fromParam || toParam) {
      if (fromParam) {
        setFromDate(fromParam);
      }
      if (toParam) {
        setToDate(toParam);
      }
      setYearFilter("all");
      setQuickRange("");
      if (yearParam && /^\d{4}$/.test(yearParam)) {
        const expectedFrom = `${yearParam}-01-01`;
        const expectedTo = `${yearParam}-12-31`;
        if (fromParam === expectedFrom && toParam === expectedTo) {
          setYearFilter(yearParam);
        }
      }
    } else if (quickParam && allowedQuickRanges.has(quickParam)) {
      const months = Number(quickParam.split("-")[1]);
      if (Number.isFinite(months)) {
        handleQuickRange(months);
      }
    } else if (yearParam && yearParam !== "all") {
      handleYearChange(yearParam);
    }

    setFiltersInitialized(true);
  }, [filtersInitialized, handleQuickRange, handleYearChange, providerValues]);

  useEffect(() => {
    if (!filtersInitialized) {
      return;
    }
    const params = new URLSearchParams();
    if (providerFilter !== "all") {
      params.set("provider", providerFilter);
    }
    const trimmedSearch = search.trim();
    if (trimmedSearch) {
      params.set("search", trimmedSearch);
    }
    params.set("group", breakdownMode);
    if (fromDate) {
      params.set("from", fromDate);
    }
    if (toDate) {
      params.set("to", toDate);
    }
    if (!fromDate && !toDate && yearFilter !== "all") {
      params.set("year", yearFilter);
    }

    const query = params.toString();
    const nextUrl = query ? `${window.location.pathname}?${query}` : window.location.pathname;
    window.history.replaceState(null, "", nextUrl);
  }, [filtersInitialized, providerFilter, search, breakdownMode, fromDate, toDate, yearFilter]);

  const presetLinks = useMemo(() => {
    const now = new Date();
    const currentYear = now.getUTCFullYear();
    const lastYear = currentYear - 1;
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const startLast12 = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 12, end.getUTCDate()));
    const basePath = typeof window === "undefined" ? "/ledger" : window.location.pathname;

    const buildLink = (from: Date, to: Date) => {
      const params = new URLSearchParams();
      params.set("from", formatDate(from));
      params.set("to", formatDate(to));
      params.set("group", "month");
      return `${basePath}?${params.toString()}`;
    };

    return [
      {
        label: `${currentYear} (monthly)`,
        href: buildLink(new Date(Date.UTC(currentYear, 0, 1)), new Date(Date.UTC(currentYear, 11, 31)))
      },
      {
        label: `${lastYear} (monthly)`,
        href: buildLink(new Date(Date.UTC(lastYear, 0, 1)), new Date(Date.UTC(lastYear, 11, 31)))
      },
      {
        label: "Last 12 months (monthly)",
        href: buildLink(startLast12, end)
      }
    ];
  }, []);

  const downloadMonthlyBreakdownCsv = useCallback(() => {
    const lines = ["month,currency,amount"];
    for (const row of monthlyBreakdownRows) {
      for (const [currency, amountCents] of row.totals.entries()) {
        const amount = formatAmountValue(amountCents, currency);
        lines.push([row.month, currency, amount].map(csvEscape).join(","));
      }
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv; charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `aicostledger-monthly-${formatDate(new Date())}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }, [monthlyBreakdownRows]);

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
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground">Quick ranges</label>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant={quickRange === "last-1" ? "accent" : "outline"}
                onClick={() => handleQuickRange(1)}
              >
                Last 1 month
              </Button>
              <Button
                type="button"
                size="sm"
                variant={quickRange === "last-3" ? "accent" : "outline"}
                onClick={() => handleQuickRange(3)}
              >
                Last 3 months
              </Button>
              <Button
                type="button"
                size="sm"
                variant={quickRange === "last-6" ? "accent" : "outline"}
                onClick={() => handleQuickRange(6)}
              >
                Last 6 months
              </Button>
              <Button
                type="button"
                size="sm"
                variant={quickRange === "last-12" ? "accent" : "outline"}
                onClick={() => handleQuickRange(12)}
              >
                Last 12 months
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground">Presets</label>
            <div className="flex flex-wrap gap-2">
              {presetLinks.map((preset) => (
                <Button key={preset.label} asChild size="sm" variant="outline">
                  <a href={preset.href}>{preset.label}</a>
                </Button>
              ))}
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-5">
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
              <label className="text-xs text-muted-foreground">Year</label>
              <select
                className="h-10 w-full rounded-2xl border border-input bg-background px-3 text-sm"
                value={yearFilter}
                onChange={(event) => handleYearChange(event.target.value)}
              >
                <option value="all">All time</option>
                {availableYears.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground">From</label>
              <Input type="date" value={fromDate} onChange={(event) => handleFromDateChange(event.target.value)} />
            </div>
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground">To</label>
              <Input type="date" value={toDate} onChange={(event) => handleToDateChange(event.target.value)} />
            </div>
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground">Search</label>
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="invoice, provider"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <CardTitle>Breakdown</CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={downloadMonthlyBreakdownCsv}
            disabled={!monthlyBreakdownRows.length}
          >
            Download monthly CSV
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-xs text-muted-foreground">Group by</label>
            <select
              className="h-9 rounded-2xl border border-input bg-background px-3 text-sm"
              value={breakdownMode}
              onChange={(event) => setBreakdownMode(event.target.value as BreakdownMode)}
            >
              <option value="month">Month</option>
              <option value="provider">Provider</option>
              <option value="month-provider">Month + Provider</option>
            </select>
          </div>
          <div className="rounded-2xl border border-muted">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Group</TableHead>
                  <TableHead>Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {breakdownRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={2} className="text-sm text-muted-foreground">
                      No breakdown available for these filters.
                    </TableCell>
                  </TableRow>
                ) : (
                  breakdownRows.map((row) => (
                    <TableRow key={row.key}>
                      <TableCell className="text-xs font-medium">{row.label}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-2">
                          {Array.from(row.totals.entries()).map(([currency, amount]) => (
                            <Badge key={`${row.key}-${currency}`} variant="outline">
                              {formatCurrency(amount, currency)}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
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
