import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { useApi } from "../lib/api";
import { useAuth } from "../lib/auth";
import { fetchLedgerItems } from "../lib/data";
import { formatCurrency, formatDate } from "../lib/date";
const PROVIDER_OPTIONS = [
    { value: "openai_chatgpt", label: "OpenAI ChatGPT" },
    { value: "openai_api", label: "OpenAI API" },
    { value: "anthropic_claude", label: "Claude (subscription)" },
    { value: "anthropic_api", label: "Anthropic API" },
    { value: "cursor", label: "Cursor" }
];
export function Ledger() {
    const { user } = useAuth();
    const { apiDownload, apiFetch } = useApi();
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [providerFilter, setProviderFilter] = useState("all");
    const [fromDate, setFromDate] = useState("");
    const [toDate, setToDate] = useState("");
    const [search, setSearch] = useState("");
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
        const totals = new Map();
        for (const item of filteredItems) {
            totals.set(item.currency, (totals.get(item.currency) ?? 0) + item.amountCents);
        }
        return totals;
    }, [filteredItems]);
    const totalsByProvider = useMemo(() => {
        const totals = new Map();
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
    const openReceipt = useCallback(async (item) => {
        if (item.invoiceUrl) {
            window.open(item.invoiceUrl, "_blank", "noopener,noreferrer");
            return;
        }
        if (!item.pdfStoragePath) {
            return;
        }
        const response = await apiFetch(`/api/receipts/${item.id}/url`);
        window.open(response.url, "_blank", "noopener,noreferrer");
    }, [apiFetch]);
    return (_jsxs("div", { className: "space-y-6", children: [_jsxs(Card, { children: [_jsx(CardHeader, { children: _jsx(CardTitle, { children: "Ledger filters" }) }), _jsxs(CardContent, { className: "grid gap-4 md:grid-cols-4", children: [_jsxs("div", { className: "space-y-2", children: [_jsx("label", { className: "text-xs text-muted-foreground", children: "Provider" }), _jsxs("select", { className: "h-10 w-full rounded-2xl border border-input bg-background px-3 text-sm", value: providerFilter, onChange: (event) => setProviderFilter(event.target.value), children: [_jsx("option", { value: "all", children: "All providers" }), PROVIDER_OPTIONS.map((option) => (_jsx("option", { value: option.value, children: option.label }, option.value)))] })] }), _jsxs("div", { className: "space-y-2", children: [_jsx("label", { className: "text-xs text-muted-foreground", children: "From" }), _jsx(Input, { type: "date", value: fromDate, onChange: (event) => setFromDate(event.target.value) })] }), _jsxs("div", { className: "space-y-2", children: [_jsx("label", { className: "text-xs text-muted-foreground", children: "To" }), _jsx(Input, { type: "date", value: toDate, onChange: (event) => setToDate(event.target.value) })] }), _jsxs("div", { className: "space-y-2", children: [_jsx("label", { className: "text-xs text-muted-foreground", children: "Search" }), _jsx(Input, { value: search, onChange: (event) => setSearch(event.target.value), placeholder: "invoice, provider" })] })] })] }), _jsxs(Card, { children: [_jsxs(CardHeader, { className: "flex flex-col gap-3 md:flex-row md:items-center md:justify-between", children: [_jsx(CardTitle, { children: "Ledger entries" }), _jsx(Button, { onClick: downloadCsv, disabled: loading, children: "Download CSV" })] }), _jsxs(CardContent, { className: "space-y-4", children: [_jsx("div", { className: "flex flex-wrap gap-3", children: totalsByCurrency.size ? (Array.from(totalsByCurrency.entries()).map(([currency, amount]) => (_jsx(Badge, { variant: "success", children: formatCurrency(amount, currency) }, currency)))) : (_jsx("span", { className: "text-sm text-muted-foreground", children: "No totals yet." })) }), _jsx("div", { className: "flex flex-wrap gap-3 text-xs text-muted-foreground", children: singleCurrency ? (Array.from(totalsByProvider.entries()).map(([provider, amount]) => (_jsxs("span", { children: [provider, ": ", formatCurrency(amount, Array.from(totalsByCurrency.keys())[0] ?? "USD")] }, provider)))) : (_jsx("span", { children: "Provider breakdown hidden for mixed currencies." })) }), _jsx("div", { className: "rounded-2xl border border-muted", children: _jsxs(Table, { children: [_jsx(TableHeader, { children: _jsxs(TableRow, { children: [_jsx(TableHead, { children: "Date" }), _jsx(TableHead, { children: "Provider" }), _jsx(TableHead, { children: "Description" }), _jsx(TableHead, { children: "Amount" }), _jsx(TableHead, { children: "Invoice" }), _jsx(TableHead, { children: "Receipt" })] }) }), _jsx(TableBody, { children: loading ? (_jsx(TableRow, { children: _jsx(TableCell, { colSpan: 6, className: "text-sm text-muted-foreground", children: "Loading ledger entries..." }) })) : filteredItems.length === 0 ? (_jsx(TableRow, { children: _jsx(TableCell, { colSpan: 6, className: "text-sm text-muted-foreground", children: "No ledger entries match these filters." }) })) : (filteredItems.map((item) => (_jsxs(TableRow, { children: [_jsx(TableCell, { className: "text-xs text-muted-foreground", children: new Date(item.occurredAt).toLocaleDateString() }), _jsx(TableCell, { className: "text-xs font-medium", children: item.providerId }), _jsx(TableCell, { className: "text-xs", children: item.description }), _jsx(TableCell, { className: "text-xs", children: formatCurrency(item.amountCents, item.currency) }), _jsx(TableCell, { className: "text-xs", children: item.invoiceNumber ?? "—" }), _jsx(TableCell, { children: _jsx(Button, { variant: "outline", size: "sm", disabled: !item.invoiceUrl && !item.pdfStoragePath, onClick: () => openReceipt(item), children: "Receipt" }) })] }, item.id)))) })] }) })] })] })] }));
}
