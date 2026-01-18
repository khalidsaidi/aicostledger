import fs from "node:fs/promises";
import path from "node:path";
import type { LedgerItemInput, ProviderId } from "@aicostledger/shared";

export type PdfPayload = {
  localId: string;
  filename: string;
  contentType: string;
  bytesBase64: string;
};

export async function sendIngest(params: {
  backendUrl: string;
  token: string;
  providerId: ProviderId;
  runId: string;
  startedAt: string;
  items: LedgerItemInput[];
  pdfs?: PdfPayload[];
}) {
  const url = `${params.backendUrl.replace(/\/$/, "")}/api/ingest`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-AICOSTLEDGER-TOKEN": params.token
    },
    body: JSON.stringify({
      providerId: params.providerId,
      runId: params.runId,
      startedAt: params.startedAt,
      items: params.items,
      pdfs: params.pdfs
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || "Ingest failed");
  }

  return response.json();
}

export async function loadPdfPayload(filePath: string, localId: string) {
  const buffer = await fs.readFile(filePath);
  return {
    localId,
    filename: path.basename(filePath),
    contentType: "application/pdf",
    bytesBase64: buffer.toString("base64")
  };
}
