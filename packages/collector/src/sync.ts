import fs from "node:fs/promises";
import { chromium } from "playwright";
import type { LedgerItemInput, ProviderId } from "@aicostledger/shared";
import { stableId } from "@aicostledger/shared";
import { getProvider } from "./providers.js";
import { collectInvoices as collectInvoicesFromContext, buildMonthRange, type DateRange } from "./core.js";
import { downloadPdf } from "./utils/download.js";
import { ensureDir, getProfileDir, getScrapeDir } from "./utils/paths.js";
import { loadPdfPayload, sendIngest } from "./ingest.js";

const CDP_URL = process.env.AICOSTLEDGER_CDP_URL;

async function getContext(providerId: ProviderId) {
  if (CDP_URL) {
    const browser = await chromium.connectOverCDP(CDP_URL, { timeout: 60_000 });
    const context = browser.contexts()[0] ?? (await browser.newContext());
    return {
      context,
      close: async () => {
        await browser.close().catch(() => undefined);
      }
    };
  }

  const profileDir = getProfileDir(providerId);
  try {
    const files = await fs.readdir(profileDir);
    if (!files.length) {
      throw new Error("Profile directory is empty");
    }
  } catch {
    throw new Error(`No session found for ${getProvider(providerId).label}. Run connect first.`);
  }

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: true,
    viewport: { width: 1365, height: 900 }
  });

  return {
    context,
    close: async () => {
      await context.close();
    }
  };
}

async function collectInvoices(
  context: Awaited<ReturnType<typeof getContext>>["context"],
  providerId: ProviderId,
  range: DateRange | null
) {
  return collectInvoicesFromContext(context, providerId, range);
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

  const contextInfo = await getContext(provider.id);
  const invoices = await collectInvoices(contextInfo.context, provider.id, range);
  const items: LedgerItemInput[] = [];
  const pdfPayloads = [] as Awaited<ReturnType<typeof loadPdfPayload>>[];
  const scrapeDir = getScrapeDir(provider.id, runId);
  await ensureDir(scrapeDir);

  const context = contextInfo.context;

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

  await contextInfo.close();

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
