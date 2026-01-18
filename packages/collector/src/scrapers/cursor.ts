import type { BrowserContext, Page } from "playwright";
import type { InvoiceRecord } from "../types.js";
import { withinRange, type DateRange } from "../utils/dates.js";
import { captureSnapshot } from "../utils/snapshot.js";
import { isStripePortal } from "./portal.js";
import { scrapeStripeInvoices } from "./stripe.js";

const debugEnabled = process.env.AICOSTLEDGER_DEBUG === "1";
const debug = (...args: Array<string | number>) => {
  if (debugEnabled) {
    console.log("[cursor]", ...args);
  }
};

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
  if (lower.includes("/expired")) {
    return false;
  }
  if (lower.includes("invoice.stripe.com") || lower.includes("js.stripe.com")) {
    return false;
  }
  return STRIPE_PORTAL_HINTS.some((hint) => lower.includes(hint));
}

function redactUrl(value: string) {
  try {
    const url = new URL(value);
    const parts = url.pathname.split("/").filter(Boolean);
    const shortPath = parts.length ? `/${parts[0]}/…` : "/";
    return `${url.origin}${shortPath}`;
  } catch (err) {
    return "unknown";
  }
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

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), timeoutMs);
    })
  ]);
}

async function gotoWithTimeout(page: Page, url: string, timeoutMs: number) {
  return Promise.race([
    page.goto(url, { waitUntil: "domcontentloaded" }).catch((err) => {
      debug("goto failed", err?.message || "unknown");
      return undefined;
    }),
    page.waitForTimeout(timeoutMs).then(() => {
      debug("goto timeout", timeoutMs);
      return undefined;
    })
  ]);
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
  const links = await withTimeout(
    page.evaluate(() => {
      return Array.from(document.querySelectorAll("a[href]")).map(
        (anchor) => (anchor as HTMLAnchorElement).href
      );
    }),
    5_000
  );
  if (!links) {
    return null;
  }
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

async function waitForStripePortalPage(context: BrowserContext, timeoutMs: number) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const portalPage = await findStripePortalPage(context);
    if (portalPage) {
      return portalPage;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return null;
}

async function openStripePortalFromCursor(page: Page, context: BrowserContext) {
  const button = page.locator("button", { hasText: /manage subscription/i }).first();
  if (!(await button.isVisible({ timeout: 2_000 }).catch(() => false))) {
    debug("manage subscription button not visible");
    return null;
  }

  debug("click manage subscription");
  const popupPromise = page.waitForEvent("popup", { timeout: 8_000 }).catch(() => null);
  await button.click({ timeout: 5_000, noWaitAfter: true, force: true }).catch(() => undefined);

  const popup = await popupPromise;
  if (popup && isStripePortalUrl(popup.url())) {
    debug("stripe portal popup detected");
    return popup;
  }

  return waitForStripePortalPage(context, 8_000);
}

async function resolveStripePortal(
  context: BrowserContext,
  page: Page,
  options: { allowExistingTab?: boolean } = {}
) {
  const allowExistingTab = options.allowExistingTab ?? true;
  if (isStripePortalUrl(page.url())) {
    return page;
  }

  if (allowExistingTab) {
    const portalPage = await findStripePortalPage(context);
    if (portalPage && isStripePortalUrl(portalPage.url())) {
      debug("stripe portal tab detected");
      return portalPage;
    }
  }

  debug("resolve portal from", redactUrl(page.url()));
  const link = await findStripePortalLink(page);
  if (link) {
    debug("stripe link found", redactUrl(link));
    await page.goto(link, { waitUntil: "domcontentloaded", timeout: 15_000 }).catch(() => undefined);
    if (isStripePortalUrl(page.url())) {
      debug("stripe portal navigated");
      return page;
    }
  }

  const currentUrl = page.url().toLowerCase();
  if (
    currentUrl.includes("stripe.com") &&
    !currentUrl.includes("invoice.stripe.com") &&
    !currentUrl.includes("js.stripe.com") &&
    (await isStripePortal(page))
  ) {
    debug("stripe portal identified by title");
    return page;
  }

  return null;
}

async function clickBillingTargets(page: Page) {
  const candidates = page.locator("a, button", { hasText: CLICK_PATTERNS });
  const count = Math.min(await candidates.count(), 10);
  for (let index = 0; index < count; index += 1) {
    const target = candidates.nth(index);
    const text = (await target.innerText({ timeout: 2_000 }).catch(() => "")) || "";
    if (!text || SKIP_PATTERNS.test(text)) {
      continue;
    }
    debug("click candidate", text);
    await target
      .click({ timeout: 5_000, noWaitAfter: true, force: true })
      .catch(() => undefined);
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
  const existingPage =
    context.pages().find((candidate) => candidate.url().includes("cursor.com/billing")) ??
    context.pages().find((candidate) => candidate.url().includes("cursor.com/dashboard")) ??
    context.pages().find((candidate) => candidate.url().includes("cursor.com")) ??
    null;
  const page = existingPage ?? (await context.newPage());
  const shouldClosePage = !existingPage;
  page.setDefaultTimeout(20_000);
  page.setDefaultNavigationTimeout(20_000);
  let invoiceRequest: CursorInvoiceRequest | null = null;
  let stripePortalPage: Page | null = null;

  if (existingPage) {
    debug("reusing existing tab", redactUrl(existingPage.url()));
    stripePortalPage = await resolveStripePortal(context, page, { allowExistingTab: true });
    if (!stripePortalPage) {
      stripePortalPage = await openStripePortalFromCursor(page, context);
    }
    if (!stripePortalPage) {
      await clickBillingTargets(page);
      debug("clicked billing targets");
      stripePortalPage = await resolveStripePortal(context, page, { allowExistingTab: true });
    }
    if (!stripePortalPage) {
      invoiceRequest = await findInvoiceRequest(page, 8_000);
      if (invoiceRequest) {
        debug("cursor billing api detected");
      }
    }
  }

  if (!stripePortalPage && !invoiceRequest) {
  for (const url of CURSOR_PORTAL_URLS) {
    debug("navigate", url);
    const requestPromise = findInvoiceRequest(page, 12_000);
    await gotoWithTimeout(page, url, 15_000);
    await page.waitForTimeout(1500);
    stripePortalPage = await resolveStripePortal(context, page);
    if (!stripePortalPage) {
      await clickBillingTargets(page);
      stripePortalPage = await resolveStripePortal(context, page);
    }
    if (stripePortalPage) {
      debug("stripe portal detected");
      break;
    }
    invoiceRequest = await requestPromise;
    if (!invoiceRequest) {
      invoiceRequest = await findInvoiceRequest(page, 8_000);
    }
    if (invoiceRequest) {
      debug("cursor billing api detected");
      break;
    }
  }
  }

  if (stripePortalPage) {
    await stripePortalPage
      .waitForLoadState("networkidle", { timeout: 10_000 })
      .catch(() => undefined);
    const stripeInvoices = await scrapeStripeInvoices(stripePortalPage, range);
    debug("stripe invoices", stripeInvoices.length);
    if (!stripeInvoices.length) {
      await captureSnapshot(stripePortalPage, "cursor", "cursor-stripe-empty");
    }
    if (stripePortalPage !== page) {
      await stripePortalPage.close().catch(() => undefined);
    }
    if (shouldClosePage) {
      await page.close().catch(() => undefined);
    }
    return stripeInvoices;
  }

  if (!invoiceRequest) {
    await captureSnapshot(page, "cursor", "cursor-no-invoices");
    if (shouldClosePage) {
      await page.close().catch(() => undefined);
    }
    throw new Error("Cursor billing portal request not found.");
  }

  if (!page.url().includes("/dashboard")) {
    await gotoWithTimeout(page, "https://cursor.com/dashboard?tab=billing", 10_000);
    await page.waitForTimeout(2000);
  }

  const cursorInvoices = await fetchInvoicePages(page, invoiceRequest.payload);
  const records = cursorInvoices
    .map((invoice) => mapInvoice(invoice, range))
    .filter((entry): entry is InvoiceRecord => Boolean(entry));

  if (!records.length) {
    await captureSnapshot(page, "cursor", "cursor-empty-ledger");
  }

  if (shouldClosePage) {
    await page.close().catch(() => undefined);
  }
  return records;
}
