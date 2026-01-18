import { chromium } from "playwright";
import type { ProviderId } from "@aicostledger/shared";
import { getProvider } from "./providers.js";
import { ensureDir, getProfileDir } from "./utils/paths.js";
import { waitForEnter } from "./utils/prompt.js";

export async function connectProvider(providerId: ProviderId) {
  const provider = getProvider(providerId);
  const profileDir = getProfileDir(providerId);
  await ensureDir(profileDir);

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    viewport: { width: 1365, height: 900 }
  });

  const page = await context.newPage();
  await page.goto(provider.startUrl, { waitUntil: "domcontentloaded" });

  // User-driven login is required; we only persist the session.
  await waitForEnter(
    `Log in to ${provider.label} in the opened browser window.\nWhen billing pages load, press ENTER here to save the session.\n`
  );

  await context.close();
  return profileDir;
}
