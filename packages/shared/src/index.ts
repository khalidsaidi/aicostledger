import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import { z } from "zod";

export const providerIds = [
  "openai_chatgpt",
  "openai_api",
  "anthropic_claude",
  "anthropic_api",
  "cursor",
  "manus"
] as const;

export type ProviderId = (typeof providerIds)[number];

export const ledgerItemSource = ["scrape", "api", "email"] as const;
export type LedgerItemSource = (typeof ledgerItemSource)[number];

export const ledgerItemSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  providerId: z.enum(providerIds),
  occurredAt: z.string().datetime(),
  amountCents: z.number().int(),
  currency: z.string().min(1),
  description: z.string().min(1),
  invoiceNumber: z.string().optional().nullable(),
  invoiceUrl: z.string().url().optional().nullable(),
  pdfStoragePath: z.string().optional().nullable(),
  source: z.enum(ledgerItemSource),
  createdAt: z.string().datetime()
});

export type LedgerItem = z.infer<typeof ledgerItemSchema>;

export const ledgerItemInputSchema = ledgerItemSchema.omit({
  userId: true,
  createdAt: true
});

export type LedgerItemInput = z.infer<typeof ledgerItemInputSchema>;

export const runStatusSchema = z.enum(["started", "success", "partial", "failed"]);
export type RunStatus = z.infer<typeof runStatusSchema>;

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

export type RunLog = z.infer<typeof runLogSchema>;

export const ingestionTokenSchema = z.object({
  token: z.string().min(16)
});

export type IngestionToken = z.infer<typeof ingestionTokenSchema>;

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

const providerMeta: Record<
  ProviderId,
  { vendor: string; productType: "subscription" | "api" | "other" }
> = {
  openai_chatgpt: { vendor: "OpenAI", productType: "subscription" },
  openai_api: { vendor: "OpenAI", productType: "api" },
  anthropic_claude: { vendor: "Anthropic", productType: "subscription" },
  anthropic_api: { vendor: "Anthropic", productType: "api" },
  cursor: { vendor: "Cursor", productType: "subscription" },
  manus: { vendor: "Manus", productType: "subscription" }
};

export function stableId(
  providerId: ProviderId,
  occurredAt: string,
  amountCents: number,
  currency: string,
  invoiceNumber?: string | null
) {
  const base = [providerId, occurredAt, amountCents, currency, invoiceNumber ?? ""].join("|");
  return bytesToHex(sha256(new TextEncoder().encode(base)));
}

export function moneyToCents(amountStr: string, currency: string) {
  const normalized = amountStr.replace(/[^0-9.-]/g, "");
  if (!normalized) {
    return 0;
  }
  const value = Number.parseFloat(normalized);
  if (!Number.isFinite(value)) {
    return 0;
  }
  const zeroDecimal = ["JPY", "KRW"].includes(currency.toUpperCase());
  const factor = zeroDecimal ? 1 : 100;
  return Math.round(value * factor);
}

export function centsToAmount(amountCents: number, currency: string) {
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
