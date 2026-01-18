import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { useApi } from "../lib/api";
import { formatDate } from "../lib/date";
export function Export() {
    const { apiDownload } = useApi();
    const downloadCsv = async () => {
        const blob = await apiDownload("/api/export.csv");
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `aicostledger-${formatDate(new Date())}.csv`;
        link.click();
        URL.revokeObjectURL(url);
    };
    return (_jsxs(Card, { children: [_jsxs(CardHeader, { children: [_jsx(CardTitle, { children: "Export CSV" }), _jsx(CardDescription, { children: "Download all ledger entries as a CSV file." })] }), _jsx(CardContent, { children: _jsx(Button, { onClick: downloadCsv, children: "Download CSV" }) })] }));
}
