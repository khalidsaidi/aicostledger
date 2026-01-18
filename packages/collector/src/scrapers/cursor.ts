import type { BrowserContext, Page } from "playwright";
import type { InvoiceRecord } from "../types.js";
import { withinRange, type DateRange } from "../utils/dates.js";
import { captureSnapshot } from "../utils/snapshot.js";
import { isStripePortal } from "./portal.js";
import { scrapeStripeInvoices } from "./stripe.js";

type CursorInvoice = {
  invoiceId: string;
  date: string;
  amountCents: number;
  currency?: string;
  hostedInvoiceUrl?: string | null;
  description?: string | null;
};

type CursorInvoiceRequest = {
  url: string;
  payload: { teamId: string; page: number; pageSize: number };
};

const CURSOR_PORTAL_URLS = [
  "https://cursor.com/dashboard?tab=billing",
  "https://cursor.com/dashboard",
  "https://cursor.com/settings",
  "https://cursor.com/account",
  "https://www.cursor.com/dashboard?tab=billing",
  "https://www.cursor.com/dashboard"
];

const CLICK_PATTERNS = /(billing|invoice|subscription|payment|plan|account settings|manage)/i;
const SKIP_PATTERNS = /(log out|sign out|cookie|privacy|terms|download)/i;
const STRIPE_PORTAL_HINTS = [
  "billing.stripe.com",
  "stripe.com/billing",
  "customer-portal",
  "portal"
];

function mapInvoice(invoice: CursorInvoice, range: DateRange | null): InvoiceRecord | null {
  const date = new Date(invoice.date);
  if (Number.isNaN(date.valueOf())) {
    return null;
  }
  if (!withinRange(date, range)) {
    return null;
  }
  return {
    occurredAt: date.toISOString(),
    amountCents: invoice.amountCents,
    currency: (invoice.currency || "usd").toUpperCase(),
    description: invoice.description || "Cursor subscription",
    invoiceNumber: invoice.invoiceId,
    invoiceUrl: invoice.hostedInvoiceUrl || undefined
  };
}

function isInvoiceRequest(url: string) {
  return url.includes("/api/dashboard/list-invoices");
}

function isStripePortalUrl(url: string) {
  const lower = url.toLowerCase();
  if (!lower.includes("stripe.com")) {
    return false;
  }
  if (lower.includes("invoice.stripe.com") || lower.includes("js.stripe.com")) {
    return false;
  }
  return STRIPE_PORTAL_HINTS.some((hint) => lower.includes(hint));
}

function pickStripePortalLink(links: string[]) {
  const candidates = links
    .map((link) => link.trim())
    .filter(Boolean)
    .filter((link) => {
      const lower = link.toLowerCase();
      if (!lower.includes("stripe.com")) {
        return false;
      }
      if (lower.includes("invoice.stripe.com") || lower.includes("js.stripe.com")) {
        return false;
      }
      return STRIPE_PORTAL_HINTS.some((hint) => lower.includes(hint));
    });

  return candidates[0] ?? null;
}

async function fetchInvoicePages(page: Page, payload: CursorInvoiceRequest["payload"]) {
  const invoices = await page.evaluate(async ({ teamId, pageSize }) => {
    const collected: CursorInvoice[] = [];
    let currentPage = 1;
    let totalPages = 1;
    const base = window.location.origin;

    while (currentPage <= totalPages) {
      const response = await fetch(`${base}/api/dashboard/list-invoices`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        credentials: "include",
        body: JSON.stringify({ teamId, page: currentPage, pageSize })
      });
      if (!response.ok) {
        break;
      }
      const json = (await response.json()) as { invoices?: CursorInvoice[]; totalPages?: number };
      if (Array.isArray(json.invoices)) {
        collected.push(...json.invoices);
      }
      totalPages = json.totalPages ?? totalPages;
      currentPage += 1;
    }

    return collected;
  }, payload);

  return invoices;
}

async function findStripePortalLink(page: Page) {
  const links = await page.evaluate(() => {
    return Array.from(document.querySelectorAll("a[href]")).map(
      (anchor) => (anchor as HTMLAnchorElement).href
    );
  });
  return pickStripePortalLink(links);
}

async function findStripePortalPage(context: BrowserContext) {
  for (const candidate of context.pages()) {
    if (isStripePortalUrl(candidate.url())) {
      return candidate;
    }
  }
  return null;
}

async function resolveStripePortal(context: BrowserContext, page: Page) {
  if (isStripePortalUrl(page.url())) {
    return page;
  }

  const link = await findStripePortalLink(page);
  if (link) {
    await page.goto(link, { waitUntil: "domcontentloaded", timeout: 15_000 }).catch(() => undefined);
    if (isStripePortalUrl(page.url())) {
      return page;
    }
  }

  const portalPage = await findStripePortalPage(context);
  if (portalPage && isStripePortalUrl(portalPage.url())) {
    return portalPage;
  }

  const currentUrl = page.url().toLowerCase();
  if (
    currentUrl.includes("stripe.com") &&
    !currentUrl.includes("invoice.stripe.com") &&
    !currentUrl.includes("js.stripe.com") &&
    (await isStripePortal(page))
  ) {
    return page;
  }

  return null;
}

async function clickBillingTargets(page: Page) {
  const candidates = page.locator("a, button", { hasText: CLICK_PATTERNS });
  const count = Math.min(await candidates.count(), 10);
  for (let index = 0; index < count; index += 1) {
    const target = candidates.nth(index);
    const text = (await target.innerText().catch(() => "")) || "";
    if (!text || SKIP_PATTERNS.test(text)) {
      continue;
    }
    await target.click().catch(() => undefined);
    await page.waitForTimeout(1500);
  }
}

async function findInvoiceRequest(page: Page, timeoutMs: number) {
  const request = await page
    .waitForRequest((req) => isInvoiceRequest(req.url()), { timeout: timeoutMs })
    .catch(() => null);
  if (!request) {
    return null;
  }
  let payload: { teamId?: string; page?: number; pageSize?: number } | null = null;
  try {
    payload = request.postDataJSON() as { teamId?: string; page?: number; pageSize?: number };
  } catch (err) {
    payload = null;
  }
  if (payload?.teamId === undefined || payload.teamId === null) {
    return null;
  }
  return {
    url: request.url(),
    payload: {
      teamId: payload.teamId,
      page: payload.page ?? 1,
      pageSize: payload.pageSize ?? 100
    }
  } satisfies CursorInvoiceRequest;
}

export async function collectCursorInvoices(context: BrowserContext, range: DateRange | null) {
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  page.setDefaultNavigationTimeout(20_000);
  let invoiceRequest: CursorInvoiceRequest | null = null;
  let stripePortalPage: Page | null = null;

  for (const url of CURSOR_PORTAL_URLS) {
    const requestPromise = findInvoiceRequest(page, 12_000);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15_000 }).catch(() => undefined);
    await page.waitForTimeout(1500);
    stripePortalPage = await resolveStripePortal(context, page);
    if (!stripePortalPage) {
      await clickBillingTargets(page);
      stripePortalPage = await resolveStripePortal(context, page);
    }
    if (stripePortalPage) {
      break;
    }
    invoiceRequest = await requestPromise;
    if (!invoiceRequest) {
      invoiceRequest = await findInvoiceRequest(page, 8_000);
    }
    if (invoiceRequest) {
      break;
    }
  }

  if (stripePortalPage) {
    await stripePortalPage
      .waitForLoadState("networkidle", { timeout: 10_000 })
      .catch(() => undefined);
    const stripeInvoices = await scrapeStripeInvoices(stripePortalPage, range);
    if (!stripeInvoices.length) {
      await captureSnapshot(stripePortalPage, "cursor", "cursor-stripe-empty");
    }
    if (stripePortalPage !== page) {
      await stripePortalPage.close().catch(() => undefined);
    }
    await page.close().catch(() => undefined);
    return stripeInvoices;
  }

  if (!invoiceRequest) {
    await captureSnapshot(page, "cursor", "cursor-no-invoices");
    await page.close().catch(() => undefined);
    throw new Error("Cursor billing portal request not found.");
  }

  if (!page.url().includes("/dashboard")) {
    await page.goto("https://cursor.com/dashboard?tab=billing", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
  }

  const cursorInvoices = await fetchInvoicePages(page, invoiceRequest.payload);
  const records = cursorInvoices
    .map((invoice) => mapInvoice(invoice, range))
    .filter((entry): entry is InvoiceRecord => Boolean(entry));

  if (!records.length) {
    await captureSnapshot(page, "cursor", "cursor-empty-ledger");
  }

  await page.close().catch(() => undefined);
  return records;
}
