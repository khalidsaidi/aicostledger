import type { BrowserContext, Locator, Page } from "playwright";
import type { InvoiceRecord } from "../types.js";
import { getProvider } from "../providers.js";
import { type DateRange, withinRange } from "../utils/dates.js";
import { captureSnapshot } from "../utils/snapshot.js";
import { scrapeTableInvoices } from "./generic.js";
import { isStripePortal } from "./portal.js";
import { scrapeStripeInvoices } from "./stripe.js";

const debugEnabled = process.env.AICOSTLEDGER_DEBUG === "1";
const debug = (...args: Array<string | number>) => {
  if (debugEnabled) {
    console.log("[manus]", ...args);
  }
};

const BILLING_KEYWORDS = [
  "billing",
  "invoice",
  "subscription",
  "plan",
  "payment",
  "stripe",
  "receipt",
  "credits",
  "upgrade"
];
const MAX_BILLING_URLS = 20;
const MAX_USAGE_PAGES = 40;

const STRIPE_PORTAL_HINTS = [
  "billing.stripe.com",
  "stripe.com/billing",
  "customer-portal",
  "portal"
];

function isStripePortalLink(url: string) {
  const lower = url.toLowerCase();
  if (!lower.includes("stripe.com")) {
    return false;
  }
  if (lower.includes("invoice.stripe.com") || lower.includes("js.stripe.com")) {
    return false;
  }
  return STRIPE_PORTAL_HINTS.some((hint) => lower.includes(hint));
}

async function isLoginPage(page: Page) {
  const googleButton = page.getByRole("button", { name: /continue with google/i }).first();
  if (await googleButton.isVisible().catch(() => false)) {
    return true;
  }
  const signInText = page.locator("text=/sign in or sign up/i").first();
  if (await signInText.isVisible().catch(() => false)) {
    return true;
  }
  return false;
}

async function isNotFoundPage(page: Page) {
  const notFound = page.locator("text=/this page could not be found/i").first();
  if (await notFound.isVisible().catch(() => false)) {
    return true;
  }
  const title = (await page.title().catch(() => "")).toLowerCase();
  if (title.includes("404")) {
    return true;
  }
  const nextNotFound = await page
    .evaluate(() => {
      const data = (window as { __NEXT_DATA__?: { notFound?: boolean; props?: { pageProps?: { notFound?: boolean } } } })
        .__NEXT_DATA__;
      return Boolean(data?.notFound || data?.props?.pageProps?.notFound);
    })
    .catch(() => false);
  return nextNotFound;
}

async function clickFirstVisible(candidates: Locator[]) {
  for (const candidate of candidates) {
    if (await candidate.isVisible().catch(() => false)) {
      await candidate.click({ force: true }).catch(() => undefined);
      await pageWait(candidate);
      return true;
    }
  }
  return false;
}

async function pageWait(candidate: Locator) {
  const page = candidate.page();
  await page.waitForTimeout(400);
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
}

async function debugListCandidates(page: Page) {
  if (!debugEnabled) {
    return;
  }
  try {
    const matches = await page.$$eval("a,button", (elements) => {
      const hits: Array<{ text: string; href?: string }> = [];
      elements.forEach((el) => {
        const text = (el.textContent || "").trim();
        const href = (el as HTMLAnchorElement).href;
        const haystack = `${text} ${href || ""}`.toLowerCase();
        if (
          haystack.includes("billing") ||
          haystack.includes("subscription") ||
          haystack.includes("invoice") ||
          haystack.includes("plan") ||
          haystack.includes("payment") ||
          haystack.includes("stripe")
        ) {
          hits.push({ text, href });
        }
      });
      return hits.slice(0, 20);
    });
    if (matches.length) {
      console.log("[manus] billing candidates", matches);
    }
  } catch {
    // ignore
  }
}

function normalizeCandidateUrl(value: string, base: string) {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("javascript:")) {
    return null;
  }
  try {
    return new URL(trimmed, base).toString();
  } catch {
    return null;
  }
}

async function collectBillingUrls(page: Page) {
  const rawUrls = await page.evaluate((keywords) => {
    const hits: string[] = [];
    const elements = Array.from(
      document.querySelectorAll(
        "a[href], [role='link'], [role='menuitem'], button, [data-href], [data-url], [data-link], [data-to]"
      )
    );
    const shouldInclude = (value: string) =>
      keywords.some((keyword) => value.toLowerCase().includes(keyword));
    for (const el of elements) {
      const text = (el.textContent || "").trim();
      const aria = (el.getAttribute("aria-label") || "").trim();
      const attrs = [
        el.getAttribute("href"),
        el.getAttribute("data-href"),
        el.getAttribute("data-url"),
        el.getAttribute("data-link"),
        el.getAttribute("data-to")
      ].filter(Boolean) as string[];
      const haystack = `${text} ${aria} ${attrs.join(" ")}`.trim();
      if (!haystack) {
        continue;
      }
      if (shouldInclude(haystack)) {
        attrs.forEach((attr) => hits.push(attr));
      }
    }
    return hits.slice(0, 50);
  }, BILLING_KEYWORDS);

  const base = page.url();
  const unique = new Set<string>();
  const urls: string[] = [];
  for (const raw of rawUrls) {
    const normalized = normalizeCandidateUrl(raw, base);
    if (!normalized || unique.has(normalized)) {
      continue;
    }
    unique.add(normalized);
    urls.push(normalized);
  }
  return urls;
}

async function clickBillingTarget(page: Page) {
  const targets: Locator[] = [
    page.getByRole("link", { name: /billing|subscription|plan|invoice|payment/i }).first(),
    page.getByRole("button", { name: /billing|subscription|plan|invoice|payment|manage/i }).first(),
    page.locator("a:has-text('Billing')").first(),
    page.locator("a:has-text('Billing & Invoices')").first(),
    page.locator("a:has-text('Subscription')").first(),
    page.locator("a:has-text('Plan')").first(),
    page.locator("a:has-text('Invoice')").first(),
    page.locator("button:has-text('Billing')").first(),
    page.locator("button:has-text('Billing & Invoices')").first(),
    page.locator("button:has-text('Subscription')").first(),
    page.locator("button:has-text('Plan')").first(),
    page.locator("[role='menuitem']:has-text('Billing')").first(),
    page.locator("[role='menuitem']:has-text('Subscription')").first(),
    page.locator("[role='menuitem']:has-text('Plan')").first()
  ];
  return clickFirstVisible(targets);
}

function parseUsageDate(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    const normalized = trimmed.replace(" ", "T");
    const date = new Date(normalized.includes("Z") ? normalized : `${normalized}Z`);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return new Date(parsed);
}

function parseCreditsDelta(value: string) {
  const cleaned = value.replace(/[^0-9.+-]/g, "");
  if (!cleaned) {
    return null;
  }
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed;
}

async function waitForUsageTable(page: Page) {
  const dialog = page.locator("[role='dialog']").first();
  if (await dialog.isVisible().catch(() => false)) {
    const usageNav = dialog
      .locator("button:has-text('Usage'), [role='button']:has-text('Usage')")
      .first();
    if (await usageNav.isVisible().catch(() => false)) {
      await usageNav.click({ force: true }).catch(() => undefined);
      await page.waitForTimeout(400);
    }
  }
  await dialog.waitFor({ state: "visible", timeout: 10_000 }).catch(() => undefined);
  await dialog
    .locator("a[href^='/app/']")
    .first()
    .waitFor({ state: "visible", timeout: 10_000 })
    .catch(() => undefined);
  await dialog
    .locator("text=/credits change/i")
    .first()
    .waitFor({ state: "visible", timeout: 10_000 })
    .catch(() => undefined);
}

async function collectUsageRows(page: Page) {
  const maxAttempts = 3;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const dialog = page.locator("[role='dialog']").first();
      const listItems = dialog.locator("a[href^='/app/']");
      const listCount = await listItems.count();
      if (listCount) {
        const rows: Array<{ details: string; date: string; delta: string }> = [];
        for (let index = 0; index < listCount; index += 1) {
          const item = listItems.nth(index);
          const firstLine = item.locator("p").first();
          const spans = await firstLine.locator("span").allTextContents();
          const secondLine = item.locator("p").nth(1);
          const date = (await secondLine.innerText().catch(() => "")).trim();
          if (spans.length >= 2) {
            rows.push({
              details: spans[0]?.trim() || "",
              date,
              delta: spans[1]?.trim() || ""
            });
          }
        }
        return rows;
      }

      const tables = page.locator("table");
      const tableCount = await tables.count();
      for (let index = 0; index < tableCount; index += 1) {
        const table = tables.nth(index);
        const headers = (await table.locator("th").allTextContents()).map((text) =>
          text.toLowerCase()
        );
        if (!headers.some((text) => text.includes("credits")) || !headers.some((text) => text.includes("date"))) {
          continue;
        }
        const rows: Array<{ details: string; date: string; delta: string }> = [];
        const rowLocator = table.locator("tbody tr");
        const rowCount = await rowLocator.count();
        for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
          const cells = await rowLocator.nth(rowIndex).locator("td").allTextContents();
          if (cells.length >= 3) {
            rows.push({
              details: cells[0]?.trim() || "",
              date: cells[1]?.trim() || "",
              delta: cells[2]?.trim() || ""
            });
          }
        }
        return rows;
      }

      const antRows = page.locator(".ant-table-row");
      const antCount = await antRows.count();
      const rows: Array<{ details: string; date: string; delta: string }> = [];
      for (let rowIndex = 0; rowIndex < antCount; rowIndex += 1) {
        const cells = await antRows.nth(rowIndex).locator(".ant-table-cell").allTextContents();
        if (cells.length >= 3) {
          rows.push({
            details: cells[0]?.trim() || "",
            date: cells[1]?.trim() || "",
            delta: cells[2]?.trim() || ""
          });
        }
      }
      return rows;
    } catch (error) {
      const message = (error as Error).message || "";
      if (message.includes("Execution context was destroyed") || message.includes("Target closed")) {
        await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
        await page.waitForTimeout(500);
        continue;
      }
      throw error;
    }
  }
  return [];
}

async function paginateUsageTable(page: Page, range: DateRange | null) {
  const collected: InvoiceRecord[] = [];
  const seenPages = new Set<string>();
  let direction: "next" | "prev" | null = null;

  const getPageSignature = (rows: Array<{ details: string; date: string; delta: string }>) =>
    rows.map((row) => `${row.date}|${row.details}|${row.delta}`).join("||");

  const readPage = async () => {
    await waitForUsageTable(page);
    const rows = await collectUsageRows(page);
    const signature = getPageSignature(rows);
    if (signature && seenPages.has(signature)) {
      return { rows, signature, duplicate: true };
    }
    if (signature) {
      seenPages.add(signature);
    }
    return { rows, signature, duplicate: false };
  };

  const clickPageButton = async (button: Locator) => {
    const className = (await button.getAttribute("class").catch(() => "")) || "";
    const ariaDisabled = (await button.getAttribute("aria-disabled").catch(() => "")) || "";
    if (className.includes("disabled") || ariaDisabled === "true") {
      return false;
    }
    const innerButton = button.locator("button").first();
    if (await innerButton.isVisible().catch(() => false)) {
      const disabled = await innerButton.isDisabled().catch(() => false);
      if (disabled) {
        return false;
      }
      await innerButton.click({ force: true }).catch(() => undefined);
    } else {
      await button.click({ force: true }).catch(() => undefined);
    }
    await page.waitForTimeout(800);
    return true;
  };

  const getButton = (dir: "next" | "prev") => {
    const label = dir === "next" ? /next/i : /previous|prev/i;
    return page
      .locator(`.ant-pagination-${dir}, .ant-pagination-item-link`)
      .filter({ hasText: label })
      .first();
  };

  let pageCount = 0;
  let previousEarliest: number | null = null;

  while (pageCount < MAX_USAGE_PAGES) {
    const { rows, duplicate } = await readPage();
    if (!rows.length || duplicate) {
      break;
    }

    let earliestTimestamp: number | null = null;
    rows.forEach((row) => {
      const date = parseUsageDate(row.date);
      if (!date) {
        return;
      }
      const timestamp = date.getTime();
      if (earliestTimestamp === null || timestamp < earliestTimestamp) {
        earliestTimestamp = timestamp;
      }
      const delta = parseCreditsDelta(row.delta);
      if (delta === null || !withinRange(date, range)) {
        return;
      }
      collected.push({
        occurredAt: date.toISOString(),
        amountCents: Math.round(delta * 100),
        currency: "CREDITS",
        description: row.details || "Manus usage",
        invoiceNumber: undefined,
        invoiceUrl: undefined
      });
    });

    pageCount += 1;

    if (range?.start && earliestTimestamp !== null && earliestTimestamp < range.start.getTime()) {
      break;
    }

    if (!direction && previousEarliest !== null) {
      if (earliestTimestamp !== null && earliestTimestamp < previousEarliest) {
        direction = "next";
      } else if (earliestTimestamp !== null && earliestTimestamp > previousEarliest) {
        direction = "prev";
      }
    }
    previousEarliest = earliestTimestamp;

    if (!direction) {
      const nextBtn = getButton("next");
      if (await nextBtn.count()) {
        if (await clickPageButton(nextBtn)) {
          direction = "next";
          continue;
        }
      }
      const prevBtn = getButton("prev");
      if (await prevBtn.count()) {
        if (await clickPageButton(prevBtn)) {
          direction = "prev";
          continue;
        }
      }
      break;
    }

    const button = getButton(direction);
    if (!(await button.count()) || !(await clickPageButton(button))) {
      break;
    }
  }

  return collected;
}

async function tryUsageHistory(page: Page, range: DateRange | null) {
  const usageLink = page.locator("text=/usage/i").first();
  if (!(await usageLink.isVisible().catch(() => false))) {
    await page.evaluate(() => {
      if (!location.hash.includes("settings/usage")) {
        location.hash = "settings/usage";
      }
    }).catch(() => undefined);
    await page.waitForTimeout(600);
  } else {
    await usageLink.click({ force: true }).catch(() => undefined);
    await page.waitForTimeout(400);
  }

  const usageHeader = page.locator("text=/usage/i").first();
  if (!(await usageHeader.isVisible().catch(() => false))) {
    return [];
  }

  return paginateUsageTable(page, range);
}

async function openBillingMenu(page: Page) {
  const triggers: Locator[] = [
    page.getByRole("button", { name: /manus/i }).first(),
    page.getByRole("button", { name: /workspace|plan|free plan|pro|lite/i }).first(),
    page.getByRole("button", { name: /^[A-Z]$/ }).first(),
    page.locator("[role='button']:has-text('Manus')").first(),
    page.locator("[role='button']:has-text('Lite')").first(),
    page.locator("[role='button']:has-text('Pro')").first(),
    page.locator("[role='button']:has-text('Free')").first(),
    page.locator("button[aria-haspopup='menu']").first(),
    page.locator("[role='button'][aria-haspopup='menu']").first(),
    page.locator("button[aria-label*='account']").first(),
    page.locator("button[aria-label*='profile']").first(),
    page.locator("button[aria-label*='user']").first()
  ];
  for (const trigger of triggers) {
    if (await trigger.isVisible().catch(() => false)) {
      await trigger.click({ force: true }).catch(() => undefined);
      await page.waitForTimeout(400);
      if (await clickBillingTarget(page)) {
        return true;
      }
    }
  }
  return false;
}

async function navigateToBilling(page: Page) {
  const attempted = new Set<string>();
  const tryUrls = async (urls: string[]) => {
    for (const raw of urls) {
      const normalized = normalizeCandidateUrl(raw, page.url());
      if (!normalized || attempted.has(normalized)) {
        continue;
      }
      attempted.add(normalized);
      await page.goto(normalized, { waitUntil: "domcontentloaded" }).catch(() => undefined);
      await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
      await page.waitForTimeout(500);
      if (await isNotFoundPage(page)) {
        continue;
      }
      if (await clickBillingTarget(page)) {
        return true;
      }
    }
    return false;
  };

  await debugListCandidates(page);
  if (await clickBillingTarget(page)) {
    return true;
  }

  const settingsTargets: Locator[] = [
    page.getByRole("link", { name: /settings|account/i }).first(),
    page.getByRole("button", { name: /settings|account/i }).first(),
    page.locator("a:has-text('Settings')").first(),
    page.locator("button:has-text('Settings')").first()
  ];
  if (await clickFirstVisible(settingsTargets)) {
    if (await clickBillingTarget(page)) {
      return true;
    }
  }

  if (await openBillingMenu(page)) {
    return true;
  }

  const discoveredUrls = await collectBillingUrls(page);
  if (await tryUrls(discoveredUrls)) {
    return true;
  }

  const directUrls = [
    "https://manus.im/app/billing",
    "https://manus.im/app?tab=billing",
    "https://manus.im/app?section=billing",
    "https://manus.im/app/invoices",
    "https://manus.im/app/settings/billing",
    "https://manus.im/app/settings?tab=billing",
    "https://manus.im/app/settings?section=billing",
    "https://manus.im/app/account/billing",
    "https://manus.im/app/subscription",
    "https://manus.im/app/plan",
    "https://manus.im/billing",
    "https://manus.im/settings/billing",
    "https://manus.im/settings",
    "https://manus.im/account",
    "https://manus.im/subscription",
    "https://manus.im/plan"
  ];
  if (await tryUrls(directUrls)) {
    return true;
  }

  return false;
}

async function watchStripePortal(page: Page, durationMs = 4_000) {
  let found: string | null = null;
  const onRequest = (request: { url: () => string }) => {
    const url = request.url();
    if (isStripePortalLink(url)) {
      found = url;
    }
  };
  const onResponse = async (response: { url: () => string; headers: () => Record<string, string>; text: () => Promise<string> }) => {
    if (found) {
      return;
    }
    const url = response.url();
    if (isStripePortalLink(url)) {
      found = url;
      return;
    }
    const contentType = response.headers()["content-type"] || "";
    if (!contentType.includes("application/json")) {
      return;
    }
    try {
      const body = await response.text();
      const match = body.match(/https?:\/\/[^"'\s]*stripe\.com[^"'\s]*/i);
      if (match?.[0] && isStripePortalLink(match[0])) {
        found = match[0];
      }
    } catch {
      // ignore
    }
  };

  page.on("request", onRequest);
  page.on("response", onResponse);
  const deadline = Date.now() + durationMs;
  while (!found && Date.now() < deadline) {
    await page.waitForTimeout(250);
  }
  page.off("request", onRequest);
  page.off("response", onResponse);
  return found;
}

async function findStripeLink(page: Page) {
  const locator = page.locator("a[href*='stripe.com']");
  const count = await locator.count().catch(() => 0);
  for (let index = 0; index < count; index += 1) {
    const href = await locator.nth(index).getAttribute("href").catch(() => null);
    if (!href) {
      continue;
    }
    const absolute = new URL(href, page.url()).toString();
    if (isStripePortalLink(absolute)) {
      return absolute;
    }
  }
  return null;
}

async function clickManageSubscription(page: Page) {
  const candidates = [
    page.getByRole("button", { name: /manage subscription/i }).first(),
    page.locator('[role="button"]:has-text("Manage subscription")').first(),
    page.locator('button:has-text("Manage subscription")').first(),
    page.locator("text=/manage subscription/i").first()
  ];
  for (const candidate of candidates) {
    if (await candidate.isVisible().catch(() => false)) {
      await candidate.click({ force: true }).catch(() => undefined);
      await page.waitForTimeout(500);
      return true;
    }
  }
  return false;
}

async function captureStripeFromAction(page: Page, action: () => Promise<void>) {
  let captured: string | null = null;
  const handleRequest = (request: { url: () => string }) => {
    const url = request.url();
    if (isStripePortalLink(url)) {
      captured = url;
    }
  };
  page.on("request", handleRequest);
  const popupPromise = page.waitForEvent("popup", { timeout: 5_000 }).catch(() => null);
  try {
    await action();
  } finally {
    page.off("request", handleRequest);
  }
  const popup = await popupPromise;
  return { popup, captured };
}

async function openStripePortal(page: Page) {
  const initialNetworkStripe = await watchStripePortal(page, 1500);
  if (initialNetworkStripe) {
    debug("captured stripe portal from network", initialNetworkStripe);
    await page.goto(initialNetworkStripe, { waitUntil: "domcontentloaded" }).catch(() => undefined);
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
    return page;
  }

  let stripeHref = await findStripeLink(page);
  if (!stripeHref) {
    const networkPromise = watchStripePortal(page, 5_000);
    const { popup, captured } = await captureStripeFromAction(page, async () => {
      await clickManageSubscription(page);
    });
    const networkStripe = await networkPromise;
    if (networkStripe) {
      debug("captured stripe portal from network", networkStripe);
      await page.goto(networkStripe, { waitUntil: "domcontentloaded" }).catch(() => undefined);
      await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
      return page;
    }
    if (popup) {
      await popup.waitForLoadState("domcontentloaded").catch(() => undefined);
      await popup.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
      return popup;
    }
    if (page.url().includes("stripe.com")) {
      return page;
    }
    if (captured) {
      debug("captured stripe portal", captured);
      await page.goto(captured, { waitUntil: "domcontentloaded" }).catch(() => undefined);
      await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
      return page;
    }
    stripeHref = await findStripeLink(page);
  }

  if (stripeHref) {
    debug("navigating to stripe portal", stripeHref);
    await page.goto(stripeHref, { waitUntil: "domcontentloaded" }).catch(() => undefined);
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
    return page;
  }

  const menuItem = page
    .locator(
      "[role='menuitem']:has-text('Stripe'), [role='menuitem']:has-text('Manage in Stripe'), a:has-text('Stripe'), button:has-text('Stripe'), text=/manage in stripe/i"
    )
    .first();
  if (await menuItem.isVisible().catch(() => false)) {
    const networkPromise = watchStripePortal(page, 5_000);
    const { popup, captured } = await captureStripeFromAction(page, async () => {
      await menuItem.click({ force: true }).catch(() => undefined);
    });
    const networkStripe = await networkPromise;
    if (networkStripe) {
      debug("captured stripe portal from network", networkStripe);
      await page.goto(networkStripe, { waitUntil: "domcontentloaded" }).catch(() => undefined);
      await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
      return page;
    }
    if (popup) {
      await popup.waitForLoadState("domcontentloaded").catch(() => undefined);
      await popup.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
      return popup;
    }
    await page.waitForTimeout(1000);
    if (page.url().includes("stripe.com")) {
      return page;
    }
    if (captured) {
      debug("captured stripe portal", captured);
      await page.goto(captured, { waitUntil: "domcontentloaded" }).catch(() => undefined);
      await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
      return page;
    }
    stripeHref = await findStripeLink(page);
    if (stripeHref) {
      debug("navigating to stripe portal", stripeHref);
      await page.goto(stripeHref, { waitUntil: "domcontentloaded" }).catch(() => undefined);
      await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
      return page;
    }
  }

  return null;
}

export async function collectManusInvoices(
  context: BrowserContext,
  range: DateRange | null,
  existingPage?: Page
): Promise<InvoiceRecord[]> {
  const provider = getProvider("manus");
  const page = existingPage ?? (await context.newPage());
  const ownsPage = !existingPage;
  page.setDefaultTimeout(60_000);

  const queue: string[] = [];
  const queued = new Set<string>();
  const enqueue = (raw?: string | null, baseUrl?: string) => {
    if (!raw) {
      return;
    }
    if (queued.size >= MAX_BILLING_URLS) {
      return;
    }
    const normalized = normalizeCandidateUrl(raw, baseUrl ?? provider.startUrl);
    if (!normalized || queued.has(normalized)) {
      return;
    }
    queued.add(normalized);
    queue.push(normalized);
  };

  enqueue(provider.startUrl);
  provider.billingUrls.forEach((url) => enqueue(url));

  let lastUrl = provider.startUrl;

  for (let index = 0; index < queue.length; index += 1) {
    const url = queue[index];
    if (!url) {
      continue;
    }
    lastUrl = url;
    if (page.url() !== url) {
      await page.goto(url, { waitUntil: "domcontentloaded" }).catch(() => undefined);
      await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
      await page.waitForTimeout(1000);
    }

    if (await isLoginPage(page)) {
      await captureSnapshot(page, provider.id, "login-required");
      throw new Error("Manus session is not authenticated");
    }

    if (await isNotFoundPage(page)) {
      continue;
    }

    const usageInvoices = await tryUsageHistory(page, range).catch(() => []);
    if (usageInvoices.length) {
      if (ownsPage) {
        await page.close().catch(() => undefined);
      }
      return usageInvoices;
    }

    await navigateToBilling(page);
    const discovered = await collectBillingUrls(page);
    discovered.forEach((candidate) => enqueue(candidate, page.url()));

    const stripePage = await openStripePortal(page);
    if (stripePage) {
      lastUrl = stripePage.url();
      if (await isStripePortal(stripePage)) {
        const invoices = await scrapeStripeInvoices(stripePage, range);
        if (stripePage !== page) {
          await stripePage.close().catch(() => undefined);
        }
        if (invoices.length) {
          if (ownsPage) {
            await page.close().catch(() => undefined);
          }
          return invoices;
        }
      } else if (stripePage !== page) {
        await stripePage.close().catch(() => undefined);
      }
    }

    const invoices = await scrapeTableInvoices(page, range);
    if (invoices.length) {
      if (ownsPage) {
        await page.close().catch(() => undefined);
      }
      return invoices;
    }
  }

  await captureSnapshot(page, provider.id, "no-invoices");
  if (ownsPage) {
    await page.close().catch(() => undefined);
  }
  throw new Error(`No invoices found at ${lastUrl}`);
}
