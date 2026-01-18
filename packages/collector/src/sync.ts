import fs from "node:fs/promises";
import { chromium } from "playwright";
import type { LedgerItemInput, ProviderId } from "@aicostledger/shared";
import { stableId } from "@aicostledger/shared";
import { getProvider } from "./providers.js";
import { scrapeStripeInvoices } from "./scrapers/stripe.js";
import { scrapeTableInvoices } from "./scrapers/generic.js";
import { collectChatGptInvoices } from "./scrapers/chatgpt.js";
import { collectCursorInvoices } from "./scrapers/cursor.js";
import { isStripePortal } from "./scrapers/portal.js";
import type { InvoiceRecord } from "./types.js";
import { buildMonthRange, type DateRange } from "./utils/dates.js";
import { downloadPdf } from "./utils/download.js";
import { ensureDir, getProfileDir, getScrapeDir } from "./utils/paths.js";
import { captureSnapshot } from "./utils/snapshot.js";
import { loadPdfPayload, sendIngest } from "./ingest.js";

const CDP_URL = process.env.AICOSTLEDGER_CDP_URL;

function pickStripePortalLink(links: string[]) {
  const candidates = links
    .map((link) => link.trim())
    .filter(Boolean)
    .filter((link) => {
      const lower = link.toLowerCase();
      if (!lower.includes("stripe.com")) {
        return false;
      }
      if (lower.includes("invoice.stripe.com")) {
        return false;
      }
      return (
        lower.includes("billing.stripe.com") ||
        lower.includes("stripe.com/billing") ||
        lower.includes("customer-portal") ||
        lower.includes("portal")
      );
    });

  return candidates[0] ?? null;
}

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

async function collectInvoices(context: Awaited<ReturnType<typeof getContext>>["context"], providerId: ProviderId, range: DateRange | null) {
  if (providerId === "openai_chatgpt") {
    return collectChatGptInvoices(context, range);
  }
  if (providerId === "cursor") {
    return collectCursorInvoices(context, range);
  }

  const provider = getProvider(providerId);
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);

  let invoices: InvoiceRecord[] = [];
  let lastUrl = provider.startUrl;

  for (const url of provider.billingUrls) {
    lastUrl = url;
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
    await page.waitForTimeout(1000);

    const stripeLinks = await page.evaluate(() => {
      return Array.from(document.querySelectorAll("a[href*='stripe.com']")).map(
        (anchor) => (anchor as HTMLAnchorElement).href
      );
    });
    const stripeHref = pickStripePortalLink(stripeLinks);

    if (stripeHref) {
      lastUrl = stripeHref;
      await page.goto(stripeHref, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
    }

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
    await page.close().catch(() => undefined);
    throw new Error(`No invoices found at ${lastUrl}`);
  }

  await page.close().catch(() => undefined);
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
