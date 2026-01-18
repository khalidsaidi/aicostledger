import type { Page } from "playwright";

export async function isStripePortal(page: Page) {
  const url = page.url();
  if (url.includes("billing.stripe.com") || url.includes("stripe.com")) {
    return true;
  }
  const title = (await page.title()).toLowerCase();
  return title.includes("stripe") && title.includes("billing");
}
