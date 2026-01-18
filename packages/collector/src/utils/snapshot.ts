import fs from "node:fs/promises";
import path from "node:path";
import type { Page } from "playwright";
import { ensureDir, getSnapshotDir } from "./paths.js";

export async function captureSnapshot(page: Page, providerId: string, label: string) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = getSnapshotDir(providerId, timestamp);
  await ensureDir(dir);
  const html = await page.content();
  await fs.writeFile(path.join(dir, `${label}.html`), html, "utf-8");
  await page.screenshot({ path: path.join(dir, `${label}.png`), fullPage: true });
  return dir;
}
