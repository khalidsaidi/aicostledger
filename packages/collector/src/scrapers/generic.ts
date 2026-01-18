import type { Page } from "playwright";
import { parseAmount } from "../utils/currency.js";
import { withinRange, type DateRange } from "../utils/dates.js";
import type { InvoiceRecord } from "../types.js";

function parseDateCell(cell: string) {
  const parsed = Date.parse(cell);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return new Date(parsed);
}

export async function scrapeTableInvoices(page: Page, range: DateRange | null) {
  await page.waitForLoadState("networkidle");

  const rows = await page.evaluate(() => {
    const collected: Array<{ cells: string[]; link?: string }> = [];
    const tables = Array.from(document.querySelectorAll("table"));
    tables.forEach((table) => {
      const bodyRows = Array.from(table.querySelectorAll("tbody tr"));
      bodyRows.forEach((row) => {
        const cells = Array.from(row.querySelectorAll("td")).map((cell) =>
          (cell.textContent || "").trim()
        );
        const href = row.querySelector("a[href]")?.getAttribute("href") || undefined;
        const link = href ? new URL(href, document.baseURI).toString() : undefined;
        if (cells.length) {
          collected.push({ cells, link });
        }
      });
    });
    return collected;
  });

  const invoices: InvoiceRecord[] = [];

  for (const row of rows) {
    const cells = row.cells.filter(Boolean);
    if (!cells.length) {
      continue;
    }

    const dateCell = cells.find((cell) => parseDateCell(cell));
    const date = dateCell ? parseDateCell(dateCell) : null;
    if (!date || !withinRange(date, range)) {
      continue;
    }

    const amountCell = cells.find((cell) => parseAmount(cell));
    const amount = amountCell ? parseAmount(amountCell) : null;
    if (!amount) {
      continue;
    }

    const description = cells
      .filter((cell) => cell !== dateCell && cell !== amountCell)
      .join(" ")
      .trim();

    invoices.push({
      occurredAt: date.toISOString(),
      amountCents: amount.amountCents,
      currency: amount.currency,
      description: description || "Invoice",
      invoiceNumber: undefined,
      invoiceUrl: row.link
    });
  }

  return invoices;
}
