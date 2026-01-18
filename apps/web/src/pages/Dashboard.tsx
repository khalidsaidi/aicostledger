import { useEffect, useMemo, useState } from "react";
import type { LedgerItem } from "@aicostledger/shared";
import { Badge } from "../components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { useAuth } from "../lib/auth";
import { fetchLedgerItems } from "../lib/data";
import { formatCurrency } from "../lib/date";

const MONTHS_TO_SHOW = 6;

function monthKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function Dashboard() {
  const { user } = useAuth();
  const [items, setItems] = useState<LedgerItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      return;
    }
    setLoading(true);
    fetchLedgerItems(user.uid)
      .then((data) => setItems(data))
      .finally(() => setLoading(false));
  }, [user]);

  const { totalsByMonth, totalsByCurrency, currentMonthTotals, lastMonthTotals } = useMemo(() => {
    const byMonth = new Map<string, Map<string, number>>();
    const totalsCurrency = new Map<string, number>();

    for (const item of items) {
      const date = new Date(item.occurredAt);
      const key = monthKey(date);
      const currencyMap = byMonth.get(key) ?? new Map<string, number>();
      currencyMap.set(item.currency, (currencyMap.get(item.currency) ?? 0) + item.amountCents);
      byMonth.set(key, currencyMap);

      totalsCurrency.set(item.currency, (totalsCurrency.get(item.currency) ?? 0) + item.amountCents);
    }

    const now = new Date();
    const currentKey = monthKey(now);
    const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const lastKey = monthKey(lastMonth);

    return {
      totalsByMonth: byMonth,
      totalsByCurrency: totalsCurrency,
      currentMonthTotals: byMonth.get(currentKey) ?? new Map<string, number>(),
      lastMonthTotals: byMonth.get(lastKey) ?? new Map<string, number>()
    };
  }, [items]);

  const monthSeries = useMemo(() => {
    const now = new Date();
    const months: Array<{ key: string; label: string; total: number }> = [];
    const currencyCount = totalsByCurrency.size;
    for (let i = MONTHS_TO_SHOW - 1; i >= 0; i -= 1) {
      const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      const key = monthKey(date);
      const totals = totalsByMonth.get(key) ?? new Map<string, number>();
      const total = currencyCount === 1 ? Array.from(totals.values()).reduce((sum, value) => sum + value, 0) : 0;
      months.push({
        key,
        label: date.toLocaleString(undefined, { month: "short", year: "numeric" }),
        total
      });
    }
    return months;
  }, [totalsByMonth]);

  const maxMonthTotal = Math.max(1, ...monthSeries.map((entry) => entry.total));
  const singleCurrency = totalsByCurrency.size <= 1;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Spend overview</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <div>
            <p className="text-sm text-muted-foreground">This month</p>
            <div className="flex flex-wrap gap-2">
              {loading ? (
                <span className="text-2xl font-semibold">...</span>
              ) : currentMonthTotals.size ? (
                Array.from(currentMonthTotals.entries()).map(([currency, amount]) => (
                  <Badge key={currency} variant="success">
                    {formatCurrency(amount, currency)}
                  </Badge>
                ))
              ) : (
                <span className="text-2xl font-semibold">0</span>
              )}
            </div>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Last month</p>
            <div className="flex flex-wrap gap-2">
              {loading ? (
                <span className="text-2xl font-semibold">...</span>
              ) : lastMonthTotals.size ? (
                Array.from(lastMonthTotals.entries()).map(([currency, amount]) => (
                  <Badge key={currency} variant="success">
                    {formatCurrency(amount, currency)}
                  </Badge>
                ))
              ) : (
                <span className="text-2xl font-semibold">0</span>
              )}
            </div>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">All-time</p>
            <div className="flex flex-wrap gap-2">
              {loading ? (
                <span className="text-2xl font-semibold">...</span>
              ) : totalsByCurrency.size ? (
                Array.from(totalsByCurrency.entries()).map(([currency, amount]) => (
                  <Badge key={currency} variant="success">
                    {formatCurrency(amount, currency)}
                  </Badge>
                ))
              ) : (
                <span className="text-2xl font-semibold">0</span>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Spend over time</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {singleCurrency ? (
            monthSeries.map((entry) => (
              <div key={entry.key} className="flex items-center gap-4">
                <span className="w-24 text-xs text-muted-foreground">{entry.label}</span>
                <div className="h-2 flex-1 rounded-full bg-muted">
                  <div
                    className="h-2 rounded-full bg-primary"
                    style={{ width: `${(entry.total / maxMonthTotal) * 100}%` }}
                  />
                </div>
                <span className="text-xs text-muted-foreground">
                  {formatCurrency(entry.total, Array.from(totalsByCurrency.keys())[0] ?? "USD")}
                </span>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">
              Multiple currencies detected. Chart is shown per-currency in the ledger view.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
