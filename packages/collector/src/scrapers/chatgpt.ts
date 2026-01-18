import type { BrowserContext, Page, Request } from "playwright";
import type { InvoiceRecord } from "../types.js";
import { withinRange, type DateRange } from "../utils/dates.js";
import { captureSnapshot } from "../utils/snapshot.js";

type StripeInvoice = {
  id: string;
  amount_due?: number;
  currency?: string;
  effective_at?: number | null;
  finalized_at?: number | null;
  created?: number;
  hosted_invoice_url?: string | null;
  lines?: {
    data?: Array<{
      description?: string | null;
      price_details?: { product?: { name?: string | null } | null } | null;
    }>;
  };
};

type InvoiceRequest = {
  url: string;
  headers: Record<string, string>;
};

function pickTimestamp(invoice: StripeInvoice) {
  return invoice.effective_at ?? invoice.finalized_at ?? invoice.created ?? null;
}

function pickDescription(invoice: StripeInvoice) {
  const line = invoice.lines?.data?.find((entry) => entry.description || entry.price_details?.product?.name);
  return line?.description || line?.price_details?.product?.name || "ChatGPT subscription";
}

function mapInvoice(invoice: StripeInvoice, range: DateRange | null): InvoiceRecord | null {
  const timestamp = pickTimestamp(invoice);
  if (!timestamp) {
    return null;
  }
  const date = new Date(timestamp * 1000);
  if (!withinRange(date, range)) {
    return null;
  }
  const amountCents = invoice.amount_due;
  if (typeof amountCents !== "number") {
    return null;
  }
  return {
    occurredAt: date.toISOString(),
    amountCents,
    currency: (invoice.currency || "usd").toUpperCase(),
    description: pickDescription(invoice),
    invoiceNumber: invoice.id,
    invoiceUrl: invoice.hosted_invoice_url || undefined
  };
}

function isInvoiceRequest(url: string) {
  return url.includes("/v1/billing_portal/sessions/") && url.includes("/invoices");
}

function getInvoiceRequestHeaders(request: Request) {
  const headers = { ...request.headers() };
  delete headers["content-length"];
  delete headers["content-encoding"];
  return headers;
}

function buildInvoiceUrl(baseUrl: string, startingAfter?: string) {
  const url = new URL(baseUrl);
  url.searchParams.set("limit", "100");
  url.searchParams.delete("outstanding");
  if (startingAfter) {
    url.searchParams.set("starting_after", startingAfter);
  } else {
    url.searchParams.delete("starting_after");
  }
  return url.toString();
}

async function waitForInvoiceRequest(page: Page, timeoutMs: number) {
  let invoiceRequest: InvoiceRequest | null = null;

  const handleRequest = (request: Request) => {
    if (!isInvoiceRequest(request.url())) {
      return;
    }
    const url = request.url();
    if (url.includes("outstanding=true") && invoiceRequest) {
      return;
    }
    invoiceRequest = {
      url,
      headers: getInvoiceRequestHeaders(request)
    };
  };

  page.on("request", handleRequest);

  const start = Date.now();
  while (!invoiceRequest && Date.now() - start < timeoutMs) {
    await page.waitForTimeout(500);
  }

  page.off("request", handleRequest);
  return invoiceRequest;
}

async function fetchInvoicePages(context: BrowserContext, invoiceRequest: InvoiceRequest) {
  const invoices: StripeInvoice[] = [];
  let nextUrl = buildInvoiceUrl(invoiceRequest.url);

  while (nextUrl) {
    const response = await context.request.get(nextUrl, { headers: invoiceRequest.headers });
    if (!response.ok()) {
      break;
    }
    const payload = (await response.json()) as { data?: StripeInvoice[]; has_more?: boolean };
    if (Array.isArray(payload.data)) {
      invoices.push(...payload.data);
    }
    if (!payload.has_more || !payload.data?.length) {
      break;
    }
    const last = payload.data[payload.data.length - 1];
    if (!last?.id) {
      break;
    }
    nextUrl = buildInvoiceUrl(invoiceRequest.url, last.id);
  }

  return invoices;
}

export async function collectChatGptInvoices(context: BrowserContext, range: DateRange | null) {
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);

  await page.goto("https://chatgpt.com/#settings/Account", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);

  const manage = page.getByText("Manage", { exact: true });
  const count = await manage.count();
  for (let index = 0; index < count; index += 1) {
    await manage.nth(index).click().catch(() => undefined);
    await page.waitForTimeout(2000);
  }

  const invoiceRequest = await waitForInvoiceRequest(page, 15_000);
  if (!invoiceRequest) {
    await captureSnapshot(page, "openai_chatgpt", "chatgpt-no-invoices");
    await page.close().catch(() => undefined);
    throw new Error("ChatGPT billing portal request not found.");
  }

  const stripeInvoices = await fetchInvoicePages(context, invoiceRequest);
  const records = stripeInvoices
    .map((invoice) => mapInvoice(invoice, range))
    .filter((entry): entry is InvoiceRecord => Boolean(entry));

  if (!records.length) {
    await captureSnapshot(page, "openai_chatgpt", "chatgpt-empty-ledger");
  }

  await page.close().catch(() => undefined);
  return records;
}
