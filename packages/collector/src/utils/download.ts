import fs from "node:fs/promises";
import path from "node:path";
import type { BrowserContext } from "playwright";
import { ensureDir } from "./paths.js";

function sanitizeName(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export async function downloadPdf(context: BrowserContext, url: string, outputDir: string, baseName: string) {
  await ensureDir(outputDir);
  const response = await context.request.get(url);
  if (!response.ok()) {
    return null;
  }
  const contentType = response.headers()["content-type"] || "";
  if (!contentType.includes("pdf") && !url.toLowerCase().endsWith(".pdf")) {
    return null;
  }
  const buffer = await response.body();
  const filename = `${sanitizeName(baseName)}.pdf`;
  const filePath = path.join(outputDir, filename);
  await fs.writeFile(filePath, buffer);
  return { filePath, contentType: contentType || "application/pdf" };
}
