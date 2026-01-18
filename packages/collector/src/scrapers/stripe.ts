import type { Page } from "playwright";
import { parseAmount } from "../utils/currency.js";
import { withinRange, type DateRange } from "../utils/dates.js";
import type { InvoiceRecord } from "../types.js";

const debugEnabled = process.env.AICOSTLEDGER_DEBUG === "1";
const debug = (...args: Array<string | number>) => {
  if (debugEnabled) {
    console.log("[stripe]", ...args);
  }
};

function parseDateCell(cell: string) {
  const parsed = Date.parse(cell);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return new Date(parsed);
}

function pickInvoiceNumber(cells: string[]) {
  const match = cells.find((cell) => /inv|invoice|receipt|#\d+/i.test(cell));
  if (!match) {
    return undefined;
  }
  return match.trim();
}

export async function scrapeStripeInvoices(page: Page, range: DateRange | null) {
  await page.waitForLoadState("domcontentloaded", { timeout: 30_000 }).catch(() => undefined);
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);

  const rows = await page.evaluate(() => {
    const collected: Array<{ cells: string[]; link?: string }> = [];
    const tables = Array.from(document.querySelectorAll("table"));
    tables.forEach((table) => {
      const bodyRows = Array.from(table.querySelectorAll("tbody tr"));
      bodyRows.forEach((row) => {
        const cells = Array.from(row.querySelectorAll("td")).map((cell) =>
          (cell.textContent || "").trim()
        );
        const href = row.querySelector("a[href]")?.getAttribute("href") || undefined;
        const link = href ? new URL(href, document.baseURI).toString() : undefined;
        if (cells.length) {
          collected.push({ cells, link });
        }
      });
    });
    return collected;
  });

  if (!rows.length) {
    await page
      .waitForSelector('[data-testid="billing-portal-invoice-row"]', { timeout: 30_000 })
      .catch(() => undefined);
    await page.waitForTimeout(2000);
  }
  const portalRows = rows.length ? [] : await loadPortalRows(page, range);

  const invoices: InvoiceRecord[] = [];

  for (const row of rows) {
    const cells = row.cells.filter(Boolean);
    if (!cells.length) {
      continue;
    }

    const dateCell = cells.find((cell) => parseDateCell(cell));
    const date = dateCell ? parseDateCell(dateCell) : null;
    if (!date || !withinRange(date, range)) {
      continue;
    }

    const amountCell = cells.find((cell) => parseAmount(cell));
    const amount = amountCell ? parseAmount(amountCell) : null;
    if (!amount) {
      continue;
    }

    const description = cells
      .filter((cell) => cell !== dateCell && cell !== amountCell)
      .join(" ")
      .trim();

    invoices.push({
      occurredAt: date.toISOString(),
      amountCents: amount.amountCents,
      currency: amount.currency,
      description: description || "Stripe invoice",
      invoiceNumber: pickInvoiceNumber(cells),
      invoiceUrl: row.link
    });
  }

  for (const row of portalRows) {
    const dateCell = row.spans.find((cell) => parseDateCell(cell));
    const date = dateCell ? parseDateCell(dateCell) : null;
    if (!date || !withinRange(date, range)) {
      continue;
    }

    const amountCell = row.spans.find((cell) => parseAmount(cell));
    const amount = amountCell ? parseAmount(amountCell) : null;
    if (!amount) {
      continue;
    }

    invoices.push({
      occurredAt: date.toISOString(),
      amountCents: amount.amountCents,
      currency: amount.currency,
      description: row.description || "Stripe invoice",
      invoiceUrl: row.link
    });
  }

  return invoices;
}

function findEarliestDate(rows: { spans: string[] }[]) {
  let earliest: Date | null = null;
  for (const row of rows) {
    for (const span of row.spans) {
      const parsed = parseDateCell(span);
      if (!parsed) {
        continue;
      }
      if (!earliest || parsed < earliest) {
        earliest = parsed;
      }
    }
  }
  return earliest;
}

async function loadPortalRows(page: Page, range: DateRange | null) {
  const rowSelector = '[data-testid="billing-portal-invoice-row"]';
  const viewMoreSelector =
    '[data-testid="view-more-button"], button:has-text("View more"), button:has-text("Load more"), button:has-text("Show more")';

  const readRows = async () => {
    const rows: Array<{ spans: string[]; description: string; link?: string }> = [];
    const rowLocator = page.locator(rowSelector);
    const count = await rowLocator.count();
    for (let index = 0; index < count; index += 1) {
      const row = rowLocator.nth(index);
      const spans = (await row.locator("span").allTextContents())
        .map((value) => value.trim())
        .filter(Boolean);
      const descriptionEl = row.locator('[data-testid="billing-portal-invoice-description"]').first();
      const description =
        (await descriptionEl.getAttribute("title").catch(() => null)) ||
        (await descriptionEl.innerText().catch(() => "")) ||
        "";
      const linkEl = row.locator("xpath=ancestor::a[1]").first();
      const href = (await linkEl.getAttribute("href").catch(() => "")) || "";
      const link = href ? new URL(href, page.url()).toString() : undefined;
      rows.push({ spans, description: description.trim(), link });
    }
    return rows;
  };

  await page.waitForSelector(rowSelector, { timeout: 30_000 }).catch(() => undefined);
  let rows = await readRows();
  debug("portal rows", rows.length, "attempt", 1);

  let stagnantAttempts = 0;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const earliest = findEarliestDate(rows);
    if (range?.start && earliest && earliest <= range.start) {
      return rows;
    }

    const viewMore = page.locator(viewMoreSelector).first();
    const viewMoreCount = await page.locator(viewMoreSelector).count().catch(() => 0);
    debug("view more count", viewMoreCount);
    if (!(await viewMore.isVisible({ timeout: 2_000 }).catch(() => false))) {
      break;
    }
    await viewMore
      .click({ timeout: 5_000, noWaitAfter: true, force: true })
      .catch(() => undefined);
    await page.waitForTimeout(4000);

    const nextRows = await readRows();
    debug("portal rows", nextRows.length, "attempt", attempt + 2);
    if (nextRows.length <= rows.length) {
      stagnantAttempts += 1;
    } else {
      stagnantAttempts = 0;
    }
    rows = nextRows;
    if (stagnantAttempts >= 2) {
      break;
    }
  }
  const earliest = findEarliestDate(rows);
  if (range?.start && earliest && earliest <= range.start) {
    return rows;
  }

  return rows;
}
