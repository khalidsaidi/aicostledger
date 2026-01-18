import fs from "node:fs/promises";
import { chromium } from "playwright";
import type { LedgerItemInput, ProviderId } from "@aicostledger/shared";
import { stableId } from "@aicostledger/shared";
import { getProvider } from "./providers.js";
import { scrapeStripeInvoices } from "./scrapers/stripe.js";
import { scrapeTableInvoices } from "./scrapers/generic.js";
import { isStripePortal } from "./scrapers/portal.js";
import type { InvoiceRecord } from "./types.js";
import { buildMonthRange, type DateRange } from "./utils/dates.js";
import { downloadPdf } from "./utils/download.js";
import { ensureDir, getProfileDir, getScrapeDir } from "./utils/paths.js";
import { captureSnapshot } from "./utils/snapshot.js";
import { loadPdfPayload, sendIngest } from "./ingest.js";

async function collectInvoices(providerId: ProviderId, range: DateRange | null) {
  const provider = getProvider(providerId);
  const profileDir = getProfileDir(providerId);
  try {
    const files = await fs.readdir(profileDir);
    if (!files.length) {
      throw new Error("Profile directory is empty");
    }
  } catch {
    throw new Error(`No session found for ${provider.label}. Run connect first.`);
  }

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: true,
    viewport: { width: 1365, height: 900 }
  });
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);

  let invoices: InvoiceRecord[] = [];
  let lastUrl = provider.startUrl;

  for (const url of provider.billingUrls) {
    lastUrl = url;
    await page.goto(url, { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);

    if (await isStripePortal(page)) {
      invoices = await scrapeStripeInvoices(page, range);
    } else {
      invoices = await scrapeTableInvoices(page, range);
    }

    if (invoices.length) {
      break;
    }
  }

  if (!invoices.length) {
    await captureSnapshot(page, providerId, "no-invoices");
    await context.close();
    throw new Error(`No invoices found at ${lastUrl}`);
  }

  await context.close();
  return invoices;
}

export async function syncProvider(params: {
  providerId: ProviderId;
  backendUrl: string;
  token: string;
  from?: string;
  to?: string;
}) {
  const provider = getProvider(params.providerId);
  const runId = `${provider.id}-${Date.now()}`;
  const startedAt = new Date().toISOString();
  const range = buildMonthRange(params.from, params.to);

  const invoices = await collectInvoices(provider.id, range);
  const items: LedgerItemInput[] = [];
  const pdfPayloads = [] as Awaited<ReturnType<typeof loadPdfPayload>>[];
  const scrapeDir = getScrapeDir(provider.id, runId);
  await ensureDir(scrapeDir);

  const context = await chromium.launchPersistentContext(getProfileDir(provider.id), {
    headless: true,
    viewport: { width: 1365, height: 900 }
  });

  for (const invoice of invoices) {
    const id = stableId(
      provider.id,
      invoice.occurredAt,
      invoice.amountCents,
      invoice.currency,
      invoice.invoiceNumber
    );
    let pdfInfo: { filePath: string; contentType: string } | null = null;
    if (invoice.invoiceUrl) {
      pdfInfo = await downloadPdf(context, invoice.invoiceUrl, scrapeDir, id);
    }
    if (pdfInfo) {
      const payload = await loadPdfPayload(pdfInfo.filePath, id);
      pdfPayloads.push(payload);
    }

    items.push({
      id,
      providerId: provider.id,
      occurredAt: invoice.occurredAt,
      amountCents: invoice.amountCents,
      currency: invoice.currency,
      description: invoice.description,
      invoiceNumber: invoice.invoiceNumber,
      invoiceUrl: invoice.invoiceUrl,
      source: "scrape"
    });
  }

  await context.close();

  await sendIngest({
    backendUrl: params.backendUrl,
    token: params.token,
    providerId: provider.id,
    runId,
    startedAt,
    items,
    pdfs: pdfPayloads
  });

  return { runId, items: items.length, provider: provider.label };
}
