import fs from "node:fs/promises";
import { chromium } from "playwright";
import type { ProviderId } from "@aicostledger/shared";
import { getProvider } from "./providers.js";
import { getProfileDir } from "./utils/paths.js";

async function hasProfile(providerId: ProviderId) {
  try {
    await fs.access(getProfileDir(providerId));
    return true;
  } catch {
    return false;
  }
}

export async function doctorProvider(providerId: ProviderId) {
  const provider = getProvider(providerId);
  const profileExists = await hasProfile(providerId);
  if (!profileExists) {
    return { provider: provider.label, ok: false, reason: "No profile found" };
  }

  const context = await chromium.launchPersistentContext(getProfileDir(providerId), {
    headless: true,
    viewport: { width: 1365, height: 900 }
  });
  const page = await context.newPage();
  await page.goto(provider.startUrl, { waitUntil: "domcontentloaded" });
  const url = page.url();
  const title = await page.title();
  await context.close();

  const looksLoggedOut = /login|signin|auth/i.test(url) || /sign in/i.test(title);

  return {
    provider: provider.label,
    ok: !looksLoggedOut,
    reason: looksLoggedOut ? "Login may be required" : "Session looks valid"
  };
}
