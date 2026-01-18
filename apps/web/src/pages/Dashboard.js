import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "../components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { useAuth } from "../lib/auth";
import { fetchLedgerItems } from "../lib/data";
import { formatCurrency } from "../lib/date";
const MONTHS_TO_SHOW = 6;
function monthKey(date) {
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}
export function Dashboard() {
    const { user } = useAuth();
    const [items, setItems] = useState([]);
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
        const byMonth = new Map();
        const totalsCurrency = new Map();
        for (const item of items) {
            const date = new Date(item.occurredAt);
            const key = monthKey(date);
            const currencyMap = byMonth.get(key) ?? new Map();
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
            currentMonthTotals: byMonth.get(currentKey) ?? new Map(),
            lastMonthTotals: byMonth.get(lastKey) ?? new Map()
        };
    }, [items]);
    const monthSeries = useMemo(() => {
        const now = new Date();
        const months = [];
        const currencyCount = totalsByCurrency.size;
        for (let i = MONTHS_TO_SHOW - 1; i >= 0; i -= 1) {
            const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
            const key = monthKey(date);
            const totals = totalsByMonth.get(key) ?? new Map();
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
    return (_jsxs("div", { className: "space-y-6", children: [_jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: "Spend overview" }) }), _jsxs(CardContent, { className: "grid gap-4 md:grid-cols-3", children: [_jsxs("div", { children: [_jsx("p", { className: "text-sm text-muted-foreground", children: "This month" }), _jsx("div", { className: "flex flex-wrap gap-2", children: loading ? (_jsx("span", { className: "text-2xl font-semibold", children: "..." })) : currentMonthTotals.size ? (Array.from(currentMonthTotals.entries()).map(([currency, amount]) => (_jsx(Badge, { variant: "success", children: formatCurrency(amount, currency) }, currency)))) : (_jsx("span", { className: "text-2xl font-semibold", children: "0" })) })] }), _jsxs("div", { children: [_jsx("p", { className: "text-sm text-muted-foreground", children: "Last month" }), _jsx("div", { className: "flex flex-wrap gap-2", children: loading ? (_jsx("span", { className: "text-2xl font-semibold", children: "..." })) : lastMonthTotals.size ? (Array.from(lastMonthTotals.entries()).map(([currency, amount]) => (_jsx(Badge, { variant: "success", children: formatCurrency(amount, currency) }, currency)))) : (_jsx("span", { className: "text-2xl font-semibold", children: "0" })) })] }), _jsxs("div", { children: [_jsx("p", { className: "text-sm text-muted-foreground", children: "All-time" }), _jsx("div", { className: "flex flex-wrap gap-2", children: loading ? (_jsx("span", { className: "text-2xl font-semibold", children: "..." })) : totalsByCurrency.size ? (Array.from(totalsByCurrency.entries()).map(([currency, amount]) => (_jsx(Badge, { variant: "success", children: formatCurrency(amount, currency) }, currency)))) : (_jsx("span", { className: "text-2xl font-semibold", children: "0" })) })] })] })] }), _jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: "Spend over time" }) }), _jsx(CardContent, { className: "space-y-3", children: singleCurrency ? (monthSeries.map((entry) => (_jsxs("div", { className: "flex items-center gap-4", children: [_jsx("span", { className: "w-24 text-xs text-muted-foreground", children: entry.label }), _jsx("div", { className: "h-2 flex-1 rounded-full bg-muted", children: _jsx("div", { className: "h-2 rounded-full bg-primary", style: { width: `${(entry.total / maxMonthTotal) * 100}%` } }) }), _jsx("span", { className: "text-xs text-muted-foreground", children: formatCurrency(entry.total, Array.from(totalsByCurrency.keys())[0] ?? "USD") })] }, entry.key)))) : (_jsx("p", { className: "text-sm text-muted-foreground", children: "Multiple currencies detected. Chart is shown per-currency in the ledger view." })) })] })] }));
}
