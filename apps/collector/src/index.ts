import http from "node:http";
import path from "node:path";
import fs from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import express from "express";
import httpProxy from "http-proxy";
import getPort from "get-port";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { z } from "zod";
import {
  providerIds,
  stableId,
  runLogSchema,
  ledgerItemInputSchema,
  type LedgerItem,
  type LedgerItemInput,
  type ProviderId
} from "@aicostledger/shared";
import { collectInvoices, buildMonthRange, type InvoiceRecord } from "@aicostledger/collector/core";
import { getProvider } from "@aicostledger/collector/providers";

const aiDir = process.env.AICOSTLEDGER_AI_DIR || "/tmp/aicostledger";
process.env.AICOSTLEDGER_AI_DIR = aiDir;
const CHROME_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const STEALTH_INIT_SCRIPT = `
(() => {
  const overwrite = (obj, prop, value) => {
    try {
      Object.defineProperty(obj, prop, { get: () => value, configurable: true });
    } catch {
      // Ignore if redefine fails.
    }
  };
  overwrite(navigator, "webdriver", undefined);
  overwrite(navigator, "languages", ["en-US", "en"]);
  overwrite(navigator, "plugins", [1, 2, 3, 4, 5]);
  overwrite(navigator, "platform", "Linux x86_64");
  overwrite(navigator, "deviceMemory", 8);
  overwrite(navigator, "hardwareConcurrency", 8);
  if (!window.chrome) {
    window.chrome = { runtime: {} };
  }
})();
`;
const CURSOR_OVERLAY_SCRIPT = `
(() => {
  if (window.__aicostledgerCursorOverlay) {
    return;
  }
  window.__aicostledgerCursorOverlay = true;
  const install = () => {
    if (!document.body) {
      requestAnimationFrame(install);
      return;
    }
    if (document.getElementById("__aicostledger_cursor")) {
      return;
    }
    const cursor = document.createElement("div");
    cursor.id = "__aicostledger_cursor";
    cursor.style.cssText =
      "position:fixed;left:0;top:0;width:12px;height:12px;border:2px solid #ff3b30;" +
      "border-radius:50%;background:rgba(255,59,48,0.2);pointer-events:none;" +
      "z-index:2147483647;transform:translate(-50%,-50%)";
    document.body.appendChild(cursor);
    const move = (event) => {
      cursor.style.left = event.clientX + "px";
      cursor.style.top = event.clientY + "px";
    };
    document.addEventListener("mousemove", move, { passive: true });
    document.addEventListener("pointermove", move, { passive: true });
  };
  install();
})();
`;

const XVFB_DISPLAY = process.env.XVFB_DISPLAY || ":99";
let xvfbProcess: ReturnType<typeof spawn> | null = null;

async function ensureXvfb() {
  if (process.env.DISPLAY) {
    return true;
  }
  try {
    if (xvfbProcess) {
      return true;
    }
    xvfbProcess = spawn(
      "Xvfb",
      [XVFB_DISPLAY, "-screen", "0", "1365x900x24", "-nolisten", "tcp"],
      { stdio: "ignore", detached: true }
    );
    xvfbProcess.unref();
    process.env.DISPLAY = XVFB_DISPLAY;
    return true;
  } catch (error) {
    console.warn("Xvfb unavailable, falling back to headless.");
    return false;
  }
}

async function waitForDevtools(debugPort: number, timeoutMs = 15_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`);
      if (response.ok) {
        return true;
      }
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

const firebaseProjectId =
  process.env.GOOGLE_CLOUD_PROJECT ||
  process.env.GCLOUD_PROJECT ||
  process.env.GCP_PROJECT ||
  process.env.PROJECT_ID;
const storageBucket =
  process.env.FIREBASE_STORAGE_BUCKET ||
  (firebaseProjectId ? `${firebaseProjectId}.firebasestorage.app` : undefined) ||
  (firebaseProjectId ? `${firebaseProjectId}.appspot.com` : undefined);

initializeApp(storageBucket ? { storageBucket } : undefined);

const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });
const storage = getStorage();

const app = express();
app.set("trust proxy", true);
app.use(express.json({ limit: "2mb" }));

type AuthedRequest = express.Request & {
  user?: { uid: string; email?: string | null };
};

const allowedEmails = (process.env.ALLOWED_EMAILS || "")
  .split(",")
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);

function isAllowedEmail(email?: string | null) {
  if (!email) {
    return false;
  }
  if (!allowedEmails.length) {
    return true;
  }
  return allowedEmails.includes(email.toLowerCase());
}

async function requireFirebaseAuth(req: AuthedRequest, res: express.Response, next: express.NextFunction) {
  if (
    process.env.AICOSTLEDGER_DEV_AUTH_BYPASS === "1" &&
    process.env.NODE_ENV !== "production"
  ) {
    req.user = {
      uid: process.env.AICOSTLEDGER_DEV_UID || "dev-user",
      email: process.env.AICOSTLEDGER_DEV_EMAIL || "dev@example.com"
    };
    next();
    return;
  }
  const authHeader = req.header("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: "Missing auth token" });
    return;
  }
  try {
    const decoded = await getAuth().verifyIdToken(token);
    if (!isAllowedEmail(decoded.email)) {
      res.status(403).json({ error: "Email not allowed" });
      return;
    }
    req.user = { uid: decoded.uid, email: decoded.email };
    next();
  } catch (error) {
    res.status(401).json({ error: "Invalid auth token" });
  }
}

type LoginSession = {
  id: string;
  key: string;
  uid: string;
  providerId: ProviderId;
  browserProcess: ChildProcess | null;
  userDataDir: string;
  debugPort: number;
  createdAtMs: number;
};

const sessions = new Map<string, LoginSession>();
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;

function isSessionExpired(session: LoginSession) {
  if (Date.now() - session.createdAtMs > SESSION_TTL_MS) {
    return true;
  }
  if (session.browserProcess && session.browserProcess.exitCode !== null) {
    return true;
  }
  return false;
}

function respondSessionExpired(res: express.Response) {
  res.status(410);
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.send(
    "<!doctype html><meta charset=\"utf-8\"><title>Session expired</title><p>Collector session expired. Go back and click Connect again.</p>"
  );
}

async function runCommand(command: string, args: string[], options?: { cwd?: string }) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "ignore",
      cwd: options?.cwd
    });
    child.on("error", (err) => reject(err));
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with code ${code ?? "unknown"}`));
      }
    });
  });
}

async function archiveProfileDir(uid: string, providerId: ProviderId, userDataDir: string) {
  const archiveDir = path.join(aiDir, "archives", sanitizeName(uid), providerId);
  await ensureDir(archiveDir);
  const archivePath = path.join(archiveDir, `profile-${Date.now()}.tar.gz`);
  await runCommand("tar", ["-czf", archivePath, "-C", userDataDir, "."]);
  const file = storage
    .bucket()
    .file(`collector-sessions/${uid}/${providerId}/profile.tar.gz`);
  await file.save(await fs.readFile(archivePath), {
    metadata: { contentType: "application/gzip", cacheControl: "no-store" },
    resumable: false
  });
  await fs.unlink(archivePath).catch(() => undefined);
}

async function restoreProfileDir(uid: string, providerId: ProviderId) {
  const file = storage
    .bucket()
    .file(`collector-sessions/${uid}/${providerId}/profile.tar.gz`);
  const [exists] = await file.exists();
  if (!exists) {
    return null;
  }
  const restoreDir = path.join(aiDir, "profiles", sanitizeName(uid), providerId, `restore-${Date.now()}`);
  await ensureDir(restoreDir);
  const archivePath = path.join(restoreDir, "profile.tar.gz");
  await file.download({ destination: archivePath });
  await runCommand("tar", ["-xzf", archivePath, "-C", restoreDir]);
  await fs.unlink(archivePath).catch(() => undefined);
  await fs.unlink(path.join(restoreDir, "SingletonLock")).catch(() => undefined);
  await fs.unlink(path.join(restoreDir, "SingletonCookie")).catch(() => undefined);
  await fs.unlink(path.join(restoreDir, "SingletonSocket")).catch(() => undefined);
  return restoreDir;
}

const proxy = httpProxy.createProxyServer({ ws: true, changeOrigin: true });
proxy.on("error", (err, _req, res) => {
  if (err) {
    console.warn("Proxy error", err.message || err);
  }
  if (res && "writeHead" in res) {
    res.writeHead(502).end("Proxy error");
  }
});
proxy.on("proxyRes", (_proxyRes, _req, res) => {
  res.setHeader("cache-control", "no-store");
});
proxy.on("proxyReqWs", (proxyReq) => {
  proxyReq.setHeader("origin", "http://127.0.0.1");
});

const connectSchema = z.object({
  providerId: z.enum(providerIds)
});

const finishSchema = z.object({
  sessionId: z.string().min(1),
  sessionKey: z.string().min(1)
});

const navigateSchema = z.object({
  sessionId: z.string().min(1),
  sessionKey: z.string().min(1),
  url: z.string().url()
});

const syncSchema = z.object({
  providerId: z.enum(providerIds),
  from: z.string().optional(),
  to: z.string().optional()
});

function stripDevtoolsPrefix(url: string, prefix: string) {
  if (url.startsWith(prefix)) {
    const stripped = url.slice(prefix.length);
    return stripped.length ? stripped : "/";
  }
  return url;
}

function getRequestHost(req: express.Request) {
  return (
    req.get("x-fh-requested-host") ||
    req.get("x-forwarded-host") ||
    req.get("host") ||
    "localhost"
  );
}

function getRequestProtocol(req: express.Request) {
  const forwardedProto = req.get("x-forwarded-proto");
  if (forwardedProto) {
    const value = forwardedProto.split(",")[0];
    if (value) {
      return value.trim();
    }
  }
  return req.protocol || "https";
}

async function launchLoginSession(uid: string, providerId: ProviderId) {
  const now = Date.now();
  for (const [sessionId, session] of sessions.entries()) {
    if (session.uid !== uid) {
      continue;
    }
    if (session.providerId === providerId && now - session.createdAtMs < SESSION_TTL_MS) {
      session.createdAtMs = now;
      return session;
    }
    await closeSession(sessionId);
  }
  const provider = getProvider(providerId);
  const debugPort = await getPort();
  const hasDisplay = await ensureXvfb();
  const sessionId = randomBytes(16).toString("hex");
  const userDataDir = path.join(aiDir, "profiles", sanitizeName(uid), providerId, sessionId);
  await ensureDir(userDataDir);
  const chromePath = process.env.CHROME_PATH || chromium.executablePath();
  const chromeArgs = [
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--disable-blink-features=AutomationControlled",
    "--no-sandbox",
    "--disable-setuid-sandbox",
    `--remote-debugging-port=${debugPort}`,
    "--remote-debugging-address=127.0.0.1",
    "--remote-allow-origins=*",
    ...(hasDisplay ? [] : ["--headless=new"]),
    "--new-window",
    provider.startUrl
  ];
  const browserProcess = spawn(chromePath, chromeArgs, {
    stdio: "ignore",
    detached: true,
    env: { ...process.env }
  });
  browserProcess.unref();
  if (!(await waitForDevtools(debugPort))) {
    throw new Error("Devtools not reachable");
  }
  const sessionKey = randomBytes(16).toString("hex");

  const session: LoginSession = {
    id: sessionId,
    key: sessionKey,
    uid,
    providerId,
    browserProcess,
    userDataDir,
    debugPort,
    createdAtMs: Date.now()
  };

  sessions.set(sessionId, session);
  await installCursorOverlay(session.debugPort);
  return session;
}

type DevtoolsTarget = { id: string };

async function installCursorOverlay(debugPort: number) {
  try {
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`, {
      timeout: 10_000
    });
    const context = browser.contexts()[0];
    if (!context) {
      await browser.close();
      return;
    }
    await context.addInitScript(CURSOR_OVERLAY_SCRIPT);
    const pages = context.pages();
    for (const page of pages) {
      await page.evaluate(CURSOR_OVERLAY_SCRIPT).catch(() => undefined);
    }
    await browser.close();
  } catch (error) {
    console.warn("Cursor overlay injection failed", (error as Error).message || error);
  }
}

async function resolveDevtoolsTarget(session: LoginSession): Promise<DevtoolsTarget> {
  const provider = getProvider(session.providerId);
  const preferredUrls = [provider.startUrl, ...provider.billingUrls].filter(Boolean);
  const maxAttempts = 6;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${session.debugPort}/json/list`);
      if (!response.ok) {
        throw new Error("Unable to fetch devtools targets");
      }
      const targets = (await response.json()) as Array<{ id: string; type: string; url: string }>;
      let pages = targets.filter((target) => target.type === "page");
      if (!pages.length) {
        await fetch(
          `http://127.0.0.1:${session.debugPort}/json/new?${encodeURIComponent(
            provider.startUrl
          )}`
        ).catch(() => undefined);
        await new Promise((resolve) => setTimeout(resolve, 300));
        const fallback = await fetch(`http://127.0.0.1:${session.debugPort}/json/list`);
        if (fallback.ok) {
          const fallbackTargets = (await fallback.json()) as Array<{
            id: string;
            type: string;
            url: string;
          }>;
          pages = fallbackTargets.filter((target) => target.type === "page");
        }
      }
      const preferred = pages.find((target) =>
        preferredUrls.some((url) => target.url.startsWith(url))
      );
      if (preferred) {
        return { id: preferred.id };
      }
      const last = pages[pages.length - 1];
      if (last) {
        return { id: last.id };
      }
    } catch (error) {
      if (attempt >= maxAttempts - 1) {
        throw error;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error("No devtools target found");
}

function buildDevtoolsUrl(req: express.Request, session: LoginSession, target: DevtoolsTarget) {
  const cacheBuster = `v=${session.createdAtMs}`;
  const publicBase = process.env.COLLECTOR_PUBLIC_BASE_URL;
  const baseUrl = publicBase
    ? new URL(publicBase)
    : new URL(`${getRequestProtocol(req)}://${getRequestHost(req)}`);
  const prefix = `${baseUrl.origin}/collector/devtools/${session.id}/${session.key}`;
  const wsHost = `${baseUrl.host}/collector/devtools/${session.id}/${session.key}`;
  const targetPath = `/devtools/page/${target.id}`;
  return `${prefix}/devtools/inspector.html?ws=${wsHost}${targetPath}&${cacheBuster}`;
}

async function closeSession(sessionId: string) {
  const session = sessions.get(sessionId);
  if (!session) {
    return;
  }
  sessions.delete(sessionId);
  if (session.browserProcess?.pid) {
    try {
      process.kill(-session.browserProcess.pid, "SIGTERM");
    } catch {
      try {
        session.browserProcess.kill("SIGTERM");
      } catch {
        // ignore
      }
    }
  }
}

async function saveStorageState(uid: string, providerId: ProviderId, context: BrowserContext) {
  const state = await context.storageState();
  const file = storage.bucket().file(`collector-sessions/${uid}/${providerId}/storageState.json`);
  await file.save(JSON.stringify(state), {
    metadata: { contentType: "application/json", cacheControl: "no-store" },
    resumable: false
  });
}

async function saveStorageStateFromProfile(uid: string, providerId: ProviderId, userDataDir: string) {
  const provider = getProvider(providerId);
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: true,
    viewport: { width: 1365, height: 900 },
    userAgent: CHROME_UA,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"]
  });
  await context.addInitScript(STEALTH_INIT_SCRIPT);
  const page = await context.newPage();
  await page.goto(provider.startUrl, { waitUntil: "domcontentloaded" }).catch(() => undefined);
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
  await page.waitForTimeout(1000);
  await saveStorageState(uid, providerId, context);
  await page.close().catch(() => undefined);
  await context.close().catch(() => undefined);
}

type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;

async function loadStorageState(uid: string, providerId: ProviderId): Promise<StorageState | null> {
  const file = storage.bucket().file(`collector-sessions/${uid}/${providerId}/storageState.json`);
  const [exists] = await file.exists();
  if (!exists) {
    return null;
  }
  const [buffer] = await file.download();
  const state = JSON.parse(buffer.toString("utf-8")) as StorageState;
  if (!state.cookies?.length && !state.origins?.length) {
    return null;
  }
  return state;
}

function findActiveSession(uid: string, providerId: ProviderId) {
  const now = Date.now();
  for (const session of sessions.values()) {
    if (session.uid !== uid) {
      continue;
    }
    if (session.providerId !== providerId) {
      continue;
    }
    if (now - session.createdAtMs > SESSION_TTL_MS) {
      continue;
    }
    return session;
  }
  return null;
}

async function attachToLiveSession(session: LoginSession) {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${session.debugPort}`, {
    timeout: 60_000
  });
  const context = browser.contexts()[0] ?? (await browser.newContext());
  const provider = getProvider(session.providerId);
  const preferredUrls = [provider.startUrl, ...provider.billingUrls].filter(Boolean);
  const providerHost = new URL(provider.startUrl).host;
  const pages = context.pages();
  const existingPage =
    pages.find((page) => {
      const url = page.url();
      if (!url || url === "about:blank") {
        return false;
      }
      if (preferredUrls.some((candidate) => url.startsWith(candidate))) {
        return true;
      }
      return url.includes(providerHost);
    }) ?? null;

  let page = existingPage;
  let createdPage = false;

  if (!page) {
    page = await context.newPage();
    createdPage = true;
    await page.goto(provider.startUrl, { waitUntil: "domcontentloaded" }).catch(() => undefined);
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
  }

  return { browser, context, page, createdPage };
}

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

function sanitizeName(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

type SnapshotInfo = {
  htmlPath: string;
  pngPath: string;
  storagePrefix: string;
};

async function uploadSnapshot(
  uid: string,
  providerId: ProviderId,
  page: Page,
  label: string
): Promise<SnapshotInfo | null> {
  if (page.isClosed()) {
    return null;
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = path.join(aiDir, "snapshots", sanitizeName(uid), providerId, timestamp);
  await ensureDir(dir);
  const htmlPath = path.join(dir, `${label}.html`);
  const pngPath = path.join(dir, `${label}.png`);
  const html = await page.content().catch(() => null);
  if (!html) {
    return null;
  }
  await fs.writeFile(htmlPath, html, "utf-8");
  await page
    .screenshot({ path: pngPath, fullPage: true, timeout: 15_000 })
    .catch(() => undefined);

  const storagePrefix = `collector-snapshots/${uid}/${providerId}/${timestamp}/${label}`;
  const bucket = storage.bucket();
  await bucket.file(`${storagePrefix}.html`).save(await fs.readFile(htmlPath), {
    metadata: { contentType: "text/html", cacheControl: "no-store" },
    resumable: false
  });
  await bucket.file(`${storagePrefix}.png`).save(await fs.readFile(pngPath), {
    metadata: { contentType: "image/png", cacheControl: "no-store" },
    resumable: false
  });
  return { htmlPath, pngPath, storagePrefix };
}

async function downloadPdf(
  context: BrowserContext,
  url: string,
  outputDir: string,
  baseName: string
) {
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

async function upsertLedgerItems(params: {
  uid: string;
  providerId: ProviderId;
  runId: string;
  startedAt: string;
  items: LedgerItemInput[];
  pdfMap: Map<string, string>;
}) {
  const { uid, providerId, runId, startedAt, items, pdfMap } = params;
  const ledgerRef = db.collection("users").doc(uid).collection("ledgerItems");
  const docRefs = items.map((item) => ledgerRef.doc(item.id));
  const existingDocs = docRefs.length > 0 ? await db.getAll(...docRefs) : [];
  const createdAtById = new Map<string, string>();

  existingDocs.forEach((doc) => {
    if (!doc.exists) {
      return;
    }
    const createdAt = doc.data()?.createdAt as string | { toDate?: () => Date } | undefined;
    if (typeof createdAt === "string") {
      createdAtById.set(doc.id, createdAt);
    } else if (createdAt && typeof createdAt.toDate === "function") {
      createdAtById.set(doc.id, createdAt.toDate().toISOString());
    }
  });

  const nowIso = new Date().toISOString();
  const batch = db.batch();
  items.forEach((item, index) => {
    const docRef = docRefs[index];
    if (!docRef) {
      return;
    }
    const createdAt = createdAtById.get(item.id) ?? nowIso;
    const pdfStoragePath = item.pdfStoragePath ?? pdfMap.get(item.id) ?? null;
    const payload: LedgerItem = {
      ...item,
      userId: uid,
      createdAt,
      pdfStoragePath
    };
    batch.set(docRef, payload, { merge: true });
  });
  await batch.commit();

  const runLog = runLogSchema.parse({
    runId,
    providerId,
    startedAt,
    endedAt: nowIso,
    status: "success",
    stats: {
      items: items.length,
      pdfs: pdfMap.size
    }
  });
  const runRef = db.collection("users").doc(uid).collection("runs").doc(runId);
  await runRef.set(runLog, { merge: true });

  const connectorRef = db.collection("users").doc(uid).collection("connectors").doc(providerId);
  await connectorRef.set(
    {
      providerId,
      lastRunAt: nowIso,
      lastRunId: runId,
      lastStatus: runLog.status,
      lastError: null
    },
    { merge: true }
  );
}

async function runSync(uid: string, providerId: ProviderId, from?: string, to?: string) {
  const runId = `${providerId}-${Date.now()}`;
  const startedAt = new Date().toISOString();
  const range = buildMonthRange(from, to);
  const rangeLabel = range
    ? `${range.start.toISOString()} -> ${range.end.toISOString()}`
    : "all";
  console.log(`[collector] sync start ${providerId} ${rangeLabel}`);

  let browser: Browser | null = null;
  let liveBrowser: Browser | null = null;
  let detachLiveBrowser: (() => Promise<void>) | null = null;
  let context: BrowserContext | null = null;
  let profileDir: string | null = null;
  let closeContext = true;
  let closeBrowser = true;
  let manusPage: Page | null = null;
  let createdManusPage = false;

  const liveSession = findActiveSession(uid, providerId);
  if (liveSession) {
    try {
      const attached = await attachToLiveSession(liveSession);
      liveBrowser = attached.browser;
      context = attached.context;
      manusPage = attached.page;
      createdManusPage = attached.createdPage;
      closeContext = false;
      closeBrowser = false;
      liveSession.createdAtMs = Date.now();
      detachLiveBrowser = async () => {
        const maybeDisconnect = (liveBrowser as unknown as { disconnect?: () => Promise<void> })
          ?.disconnect;
        if (maybeDisconnect) {
          await maybeDisconnect.call(liveBrowser);
        }
      };
      console.log(`[collector] using live session for ${providerId}`);
    } catch (error) {
      console.warn(
        `[collector] live session attach failed: ${(error as Error).message || error}`
      );
    }
  }

  if (!context) {
    profileDir = await restoreProfileDir(uid, providerId);
    const storageState = profileDir ? null : await loadStorageState(uid, providerId);
    if (!profileDir && !storageState) {
      throw new Error("No saved session. Run Connect first.");
    }
    if (profileDir) {
      context = await chromium.launchPersistentContext(profileDir, {
        headless: true,
        viewport: { width: 1365, height: 900 },
        userAgent: CHROME_UA,
        args: [
          "--no-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--disable-blink-features=AutomationControlled",
          "--no-first-run",
          "--no-default-browser-check"
        ]
      });
      closeBrowser = false;
    } else {
      browser = await chromium.launch({
        headless: true,
        chromiumSandbox: false,
        args: [
          "--no-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--disable-blink-features=AutomationControlled",
          "--no-first-run",
          "--no-default-browser-check"
        ]
      });
      context = await browser.newContext({
        storageState: storageState ?? undefined,
        viewport: { width: 1365, height: 900 },
        userAgent: CHROME_UA
      });
    }
  }
  if (!context) {
    throw new Error("Collector failed to create browser context.");
  }
  await context.addInitScript(STEALTH_INIT_SCRIPT);

  console.log(`[collector] collecting invoices for ${providerId}`);
  let invoices: InvoiceRecord[] = [];
  try {
    invoices = await collectInvoices(
      context,
      providerId,
      range,
      providerId === "manus" ? { page: manusPage ?? undefined } : undefined
    );
  } catch (error) {
    let snapshotInfo: SnapshotInfo | null = null;
    if (providerId === "manus") {
      const provider = getProvider(providerId);
      let snapshotPage = manusPage;
      let ownsSnapshotPage = false;
      if (!snapshotPage || snapshotPage.isClosed()) {
        snapshotPage = await context.newPage();
        ownsSnapshotPage = true;
        await snapshotPage
          .goto(provider.startUrl, { waitUntil: "domcontentloaded" })
          .catch(() => undefined);
        await snapshotPage.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
      }
      snapshotInfo = await uploadSnapshot(uid, providerId, snapshotPage, "sync-failure").catch(
        () => null
      );
      if (snapshotInfo) {
        console.log(`[collector] snapshot uploaded ${snapshotInfo.storagePrefix}`);
      }
      if (ownsSnapshotPage) {
        await snapshotPage.close().catch(() => undefined);
      }
    }
    if (snapshotInfo && error instanceof Error) {
      throw new Error(`${error.message} (snapshot: ${snapshotInfo.storagePrefix})`);
    }
    throw error;
  }
  console.log(`[collector] collected ${invoices.length} invoices for ${providerId}`);
  const items: LedgerItemInput[] = [];
  const pdfMap = new Map<string, string>();
  const scrapeDir = path.join(aiDir, "scrapes", providerId, runId);
  await ensureDir(scrapeDir);

  for (const invoice of invoices) {
    const id = stableId(
      providerId,
      invoice.occurredAt,
      invoice.amountCents,
      invoice.currency,
      invoice.invoiceNumber
    );

    let pdfInfo: { filePath: string; contentType: string } | null = null;
    if (invoice.invoiceUrl) {
      pdfInfo = await downloadPdf(context, invoice.invoiceUrl, scrapeDir, id);
    }
    if (pdfInfo) {
      const buffer = await fs.readFile(pdfInfo.filePath);
      const storagePath = `receipts/${uid}/${providerId}/${id}.pdf`;
      await storage.bucket().file(storagePath).save(buffer, {
        metadata: {
          contentType: pdfInfo.contentType,
          metadata: {
            originalFilename: path.basename(pdfInfo.filePath)
          }
        },
        resumable: false
      });
      pdfMap.set(id, storagePath);
      await fs.unlink(pdfInfo.filePath).catch(() => undefined);
    }

    items.push({
      id,
      providerId,
      occurredAt: invoice.occurredAt,
      amountCents: invoice.amountCents,
      currency: invoice.currency,
      description: invoice.description,
      invoiceNumber: invoice.invoiceNumber,
      invoiceUrl: invoice.invoiceUrl,
      source: "scrape"
    });
  }

  if (providerId === "manus" && createdManusPage && manusPage && !manusPage.isClosed()) {
    await manusPage.close().catch(() => undefined);
  }
  if (closeContext) {
    await context.close().catch(() => undefined);
  }
  if (browser && closeBrowser) {
    await browser.close().catch(() => undefined);
  }
  if (detachLiveBrowser) {
    await detachLiveBrowser().catch(() => undefined);
  }
  if (profileDir) {
    await fs.rm(profileDir, { recursive: true, force: true }).catch(() => undefined);
  }

  const parsedItems = items.map((item) => ledgerItemInputSchema.parse(item));
  await upsertLedgerItems({
    uid,
    providerId,
    runId,
    startedAt,
    items: parsedItems,
    pdfMap
  });

  console.log(
    `[collector] sync complete ${providerId} items=${items.length} pdfs=${pdfMap.size}`
  );
  return { runId, items: items.length, pdfs: pdfMap.size };
}

app.get("/collector/health", (_req, res) => {
  res.json({ ok: true });
});

app.post(
  "/collector/connect/start",
  requireFirebaseAuth,
  async (req: AuthedRequest, res) => {
    const parsed = connectSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
      return;
    }
    const uid = req.user?.uid;
    if (!uid) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    try {
      const session = await launchLoginSession(uid, parsed.data.providerId);
      const target = await resolveDevtoolsTarget(session);
      const devtoolsUrl = buildDevtoolsUrl(req, session, target);
      const expiresAt = new Date(session.createdAtMs + SESSION_TTL_MS).toISOString();
      const nowIso = new Date().toISOString();

      await db
        .collection("users")
        .doc(uid)
        .collection("connectors")
        .doc(session.providerId)
        .set(
          {
            providerId: session.providerId,
            lastStatus: "connecting",
            lastError: null,
            lastRunAt: nowIso
          },
          { merge: true }
        );

      res.json({
        sessionId: session.id,
        sessionKey: session.key,
        providerId: session.providerId,
        devtoolsUrl,
        expiresAt
      });
    } catch (error) {
      console.warn("Collector start failed", (error as Error).message || error);
      res.status(503).json({ error: "Unable to start collector session" });
    }
  }
);

app.post(
  "/collector/connect/finish",
  requireFirebaseAuth,
  async (req: AuthedRequest, res) => {
    const parsed = finishSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
      return;
    }
    const uid = req.user?.uid;
    if (!uid) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const session = sessions.get(parsed.data.sessionId);
    if (!session || session.key !== parsed.data.sessionKey) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    if (isSessionExpired(session)) {
      await closeSession(session.id);
      res.status(410).json({ error: "Session expired" });
      return;
    }
    if (session.uid !== uid) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    await saveStorageStateFromProfile(uid, session.providerId, session.userDataDir);
    try {
      await archiveProfileDir(uid, session.providerId, session.userDataDir);
    } catch (error) {
      console.warn("Profile archive failed", (error as Error).message || error);
    }
    session.createdAtMs = Date.now();

    const nowIso = new Date().toISOString();
    await db
      .collection("users")
      .doc(uid)
      .collection("connectors")
      .doc(session.providerId)
      .set(
        {
          providerId: session.providerId,
          sessionUpdatedAt: nowIso,
          lastStatus: "connected",
          lastError: null
        },
        { merge: true }
      );

    res.json({ ok: true });
  }
);

app.post(
  "/collector/connect/navigate",
  requireFirebaseAuth,
  async (req: AuthedRequest, res) => {
    const parsed = navigateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
      return;
    }
    const uid = req.user?.uid;
    if (!uid) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const { sessionId, sessionKey, url } = parsed.data;
    const session = sessions.get(sessionId);
    if (!session || session.key !== sessionKey) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    if (isSessionExpired(session)) {
      await closeSession(session.id);
      res.status(410).json({ error: "Session expired" });
      return;
    }
    if (session.uid !== uid) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    try {
      await fetch(
        `http://127.0.0.1:${session.debugPort}/json/new?${encodeURIComponent(url)}`
      );
      res.json({ ok: true, url });
    } catch (error) {
      res.status(502).json({ error: "Navigation failed" });
    }
  }
);

app.post(
  "/collector/connect/stop",
  requireFirebaseAuth,
  async (req: AuthedRequest, res) => {
    const parsed = finishSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
      return;
    }
    const uid = req.user?.uid;
    if (!uid) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const session = sessions.get(parsed.data.sessionId);
    if (!session || session.key !== parsed.data.sessionKey) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    if (session.uid !== uid) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    await closeSession(session.id);
    res.json({ ok: true });
  }
);

app.post(
  "/collector/sync",
  requireFirebaseAuth,
  async (req: AuthedRequest, res) => {
    const parsed = syncSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
      return;
    }
    const uid = req.user?.uid;
    if (!uid) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    try {
      const result = await runSync(uid, parsed.data.providerId, parsed.data.from, parsed.data.to);
      res.json({ ok: true, ...result });
    } catch (error) {
      const message = (error as Error).message || "Sync failed";
      console.warn(`Collector sync failed for ${parsed.data.providerId}: ${message}`);
      if (error instanceof Error && error.stack) {
        console.warn(error.stack);
      }
      await db
        .collection("users")
        .doc(uid)
        .collection("connectors")
        .doc(parsed.data.providerId)
        .set(
          {
            providerId: parsed.data.providerId,
            lastStatus: "failed",
            lastError: message,
            lastRunAt: new Date().toISOString()
          },
          { merge: true }
        );
      res.status(500).json({ error: message });
    }
  }
);

app.use("/collector/devtools/:sessionId/:sessionKey", async (req, res) => {
  res.setHeader("cache-control", "no-store");
  const { sessionId, sessionKey } = req.params;
  const session = sessions.get(sessionId);
  if (!session || session.key !== sessionKey) {
    res.status(404).end("Session not found");
    return;
  }
  if (isSessionExpired(session)) {
    await closeSession(session.id);
    respondSessionExpired(res);
    return;
  }
  const prefix = `/collector/devtools/${sessionId}/${sessionKey}`;
  const originalUrl = req.originalUrl || req.url || "/";
  const targetPath = stripDevtoolsPrefix(originalUrl, prefix);

  if (targetPath.startsWith("/devtools/inspector.html")) {
    try {
      const targetUrl = `http://127.0.0.1:${session.debugPort}${targetPath}`;
      const response = await fetch(targetUrl);
      const html = await response.text();
      const devtoolsPrefix = prefix;
      const wsUpgradeScript = `<script>
(function () {
  const devtoolsPrefix = ${JSON.stringify(devtoolsPrefix)};
  const devtoolsBase = window.location.origin + devtoolsPrefix + "/devtools/";
  const rewriteDevtoolsUrl = (url) => {
    if (typeof url !== "string") {
      return url;
    }
    if (url.startsWith("devtools://devtools/")) {
      return devtoolsBase + url.slice("devtools://devtools/".length);
    }
    return url;
  };
  if (window.fetch) {
    const nativeFetch = window.fetch;
    window.fetch = function (input, init) {
      if (typeof input === "string") {
        return nativeFetch.call(this, rewriteDevtoolsUrl(input), init);
      }
      if (input && typeof input === "object" && "url" in input) {
        const request = input;
        const rewritten = rewriteDevtoolsUrl(request.url);
        if (rewritten !== request.url) {
          return nativeFetch.call(this, new Request(rewritten, request), init);
        }
      }
      return nativeFetch.call(this, input, init);
    };
  }
  if (window.XMLHttpRequest) {
    const originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      return originalOpen.call(this, method, rewriteDevtoolsUrl(url), ...rest);
    };
  }
  const NativeWebSocket = window.WebSocket;
  if (!NativeWebSocket) {
    return;
  }
  window.WebSocket = function (url, protocols) {
    let nextUrl = url;
    if (typeof nextUrl === "string") {
      if (nextUrl.startsWith("ws://wss://")) {
        nextUrl = "wss://" + nextUrl.slice("ws://wss://".length);
      } else if (nextUrl.startsWith("ws://wss//")) {
        nextUrl = "wss://" + nextUrl.slice("ws://wss//".length);
      } else if (window.location.protocol === "https:" && nextUrl.startsWith("ws://")) {
        nextUrl = "wss://" + nextUrl.slice("ws://".length);
      }
    }
    return protocols ? new NativeWebSocket(nextUrl, protocols) : new NativeWebSocket(nextUrl);
  };
  window.WebSocket.prototype = NativeWebSocket.prototype;
})();
</script>`;
      const relaxedHtml = html.replace(
        /<meta[^>]+http-equiv=['"]?Content-Security-Policy['"]?[^>]*>/gi,
        ""
      );
      const injectedHtml = relaxedHtml.replace(/<head([^>]*)>/i, `<head$1>${wsUpgradeScript}`);
      res.status(response.status);
      res.setHeader("content-type", response.headers.get("content-type") || "text/html");
      res.setHeader(
        "content-security-policy",
        "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: https:; connect-src 'self' https: wss: ws:; object-src 'none'"
      );
      res.send(injectedHtml);
      return;
    } catch (error) {
      console.warn("Devtools inspector fetch failed", (error as Error).message || error);
      res.status(502).send("Devtools unavailable");
      return;
    }
  }
  const targetPathNoQuery = targetPath.split("?")[0] || targetPath;
  if (targetPathNoQuery.endsWith(".js")) {
    try {
      const targetUrl = `http://127.0.0.1:${session.debugPort}${targetPath}`;
      const response = await fetch(targetUrl, {
        headers: { "accept-encoding": "identity" }
      });
      const body = await response.text();
      res.status(response.status);
      res.setHeader("content-type", response.headers.get("content-type") || "application/javascript");
      res.setHeader("cache-control", "no-store");
      res.send(body);
      return;
    } catch (error) {
      console.warn("Devtools asset fetch failed", (error as Error).message || error);
      res.status(502).send("Devtools unavailable");
      return;
    }
  }

  req.url = targetPath;
  proxy.web(
    req,
    res,
    {
      target: `http://127.0.0.1:${session.debugPort}`
    },
    async () => {
      console.warn("Devtools proxy failed for", targetPath);
      res.status(502).send("Devtools proxy failed");
    }
  );
});

app.use((_err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(500).json({ error: "Server error" });
});

setInterval(() => {
  const now = Date.now();
  for (const [sessionId, session] of sessions.entries()) {
    if (now - session.createdAtMs > SESSION_TTL_MS || isSessionExpired(session)) {
      closeSession(sessionId).catch(() => undefined);
    }
  }
}, 60_000);

const server = http.createServer(app);
server.on("upgrade", (req, socket, head) => {
  const url = req.url || "";
  if (!url.startsWith("/collector/devtools/")) {
    socket.destroy();
    return;
  }
  const parts = url.replace("/collector/devtools/", "").split("/");
  const sessionId = parts[0] ?? "";
  const sessionKey = parts[1] ?? "";
  if (!sessionId || !sessionKey) {
    socket.destroy();
    return;
  }
  const session = sessions.get(sessionId);
  if (!session || session.key !== sessionKey) {
    socket.destroy();
    return;
  }
  if (isSessionExpired(session)) {
    closeSession(sessionId).catch(() => undefined);
    socket.destroy();
    return;
  }
  req.headers.origin = "http://127.0.0.1";
  req.headers.host = `127.0.0.1:${session.debugPort}`;
  req.url = stripDevtoolsPrefix(url, `/collector/devtools/${sessionId}/${sessionKey}`);
  proxy.ws(req, socket, head, { target: `ws://127.0.0.1:${session.debugPort}` });
});

const port = Number(process.env.PORT || 8080);
server.listen(port, () => {
  console.log(`collector listening on ${port}`);
});
