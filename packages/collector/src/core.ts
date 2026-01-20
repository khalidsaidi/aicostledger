import type { BrowserContext, Page } from "playwright";
import type { ProviderId } from "@aicostledger/shared";
import { getProvider } from "./providers.js";
import { scrapeStripeInvoices } from "./scrapers/stripe.js";
import { scrapeTableInvoices } from "./scrapers/generic.js";
import { collectChatGptInvoices } from "./scrapers/chatgpt.js";
import { collectCursorInvoices } from "./scrapers/cursor.js";
import { collectManusInvoices } from "./scrapers/manus.js";
import { isStripePortal } from "./scrapers/portal.js";
import type { InvoiceRecord } from "./types.js";
import { buildMonthRange, type DateRange } from "./utils/dates.js";
import { captureSnapshot } from "./utils/snapshot.js";

export type { DateRange, InvoiceRecord };
export { buildMonthRange };

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

async function collectStripeLinks(page: Page) {
  if (page.isClosed()) {
    return [] as string[];
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.waitForLoadState("domcontentloaded", { timeout: 5_000 }).catch(() => undefined);
      return await page.$$eval("a[href*='stripe.com']", (anchors) =>
        anchors.map((anchor) => (anchor as HTMLAnchorElement).href)
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (!message.includes("Execution context was destroyed")) {
        throw error;
      }
      await page.waitForTimeout(500);
    }
  }
  return [] as string[];
}

export async function collectInvoices(
  context: BrowserContext,
  providerId: ProviderId,
  range: DateRange | null,
  options?: { page?: Page }
): Promise<InvoiceRecord[]> {
  if (providerId === "openai_chatgpt") {
    return collectChatGptInvoices(context, range);
  }
  if (providerId === "cursor") {
    return collectCursorInvoices(context, range);
  }
  if (providerId === "manus") {
    return collectManusInvoices(context, range, options?.page);
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

    const stripeLinks = await collectStripeLinks(page);
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
