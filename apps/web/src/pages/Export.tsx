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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Export CSV</CardTitle>
        <CardDescription>Download all ledger entries as a CSV file.</CardDescription>
      </CardHeader>
      <CardContent>
        <Button onClick={downloadCsv}>Download CSV</Button>
      </CardContent>
    </Card>
  );
}
