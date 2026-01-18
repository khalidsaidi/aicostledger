import { z } from "zod";

export const providerIds = [
  "openai_chatgpt",
  "openai_api",
  "anthropic_claude",
  "anthropic_api",
  "cursor"
] as const;

export type ProviderId = (typeof providerIds)[number];

export const ledgerItemSource = ["scrape", "api", "email"] as const;
export type LedgerItemSource = (typeof ledgerItemSource)[number];

export const ledgerItemInputSchema = z.object({
  id: z.string().min(1),
  providerId: z.enum(providerIds),
  occurredAt: z.string().datetime(),
  amountCents: z.number().int(),
  currency: z.string().min(1),
  description: z.string().min(1),
  invoiceNumber: z.string().optional().nullable(),
  invoiceUrl: z.string().url().optional().nullable(),
  pdfStoragePath: z.string().optional().nullable(),
  source: z.enum(ledgerItemSource)
});

export type LedgerItemInput = z.infer<typeof ledgerItemInputSchema>;

export type LedgerItem = LedgerItemInput & {
  userId: string;
  createdAt: string;
};

export const runStatusSchema = z.enum(["started", "success", "partial", "failed"]);

export const runLogSchema = z.object({
  runId: z.string().min(1),
  providerId: z.enum(providerIds),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().optional(),
  status: runStatusSchema,
  stats: z.object({
    items: z.number().int().nonnegative(),
    pdfs: z.number().int().nonnegative()
  }),
  error: z.string().optional().nullable()
});

export type CsvRow = {
  occurredAt: string;
  providerId: string;
  vendorDisplayName: string;
  productType: string;
  amount: string;
  currency: string;
  description: string;
  invoiceNumber: string;
  receiptUrl: string;
  source: string;
  createdAt: string;
};

export const csvColumns = [
  "occurredAt",
  "providerId",
  "vendorDisplayName",
  "productType",
  "amount",
  "currency",
  "description",
  "invoiceNumber",
  "receiptUrl",
  "source",
  "createdAt"
] as const;

const providerMeta: Record<ProviderId, { vendor: string; productType: "subscription" | "api" | "other" }> = {
  openai_chatgpt: { vendor: "OpenAI", productType: "subscription" },
  openai_api: { vendor: "OpenAI", productType: "api" },
  anthropic_claude: { vendor: "Anthropic", productType: "subscription" },
  anthropic_api: { vendor: "Anthropic", productType: "api" },
  cursor: { vendor: "Cursor", productType: "subscription" }
};

function centsToAmount(amountCents: number, currency: string) {
  const zeroDecimal = ["JPY", "KRW"].includes(currency.toUpperCase());
  return zeroDecimal ? `${amountCents}` : (amountCents / 100).toFixed(2);
}

export function ledgerItemToCsvRow(item: LedgerItem, receiptUrl?: string | null): CsvRow {
  const meta = providerMeta[item.providerId];
  return {
    occurredAt: item.occurredAt,
    providerId: item.providerId,
    vendorDisplayName: meta.vendor,
    productType: meta.productType,
    amount: centsToAmount(item.amountCents, item.currency),
    currency: item.currency,
    description: item.description,
    invoiceNumber: item.invoiceNumber ?? "",
    receiptUrl: receiptUrl ?? item.invoiceUrl ?? item.pdfStoragePath ?? "",
    source: item.source,
    createdAt: item.createdAt
  };
}

export function csvRowToLine(row: CsvRow) {
  const values = csvColumns.map((column) => {
    const raw = row[column] ?? "";
    const value = String(raw);
    if (value.includes(",") || value.includes("\"") || value.includes("\n")) {
      return `"${value.replace(/"/g, "\"\"")}"`;
    }
    return value;
  });
  return values.join(",");
}
