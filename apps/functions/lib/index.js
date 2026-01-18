import express from "express";
import { onRequest } from "firebase-functions/v2/https";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { csvColumns, csvRowToLine, ledgerItemInputSchema, ledgerItemToCsvRow, providerIds, runLogSchema } from "@aicostledger/shared";
initializeApp();
const db = getFirestore();
const storage = getStorage();
const app = express();
app.use(express.json({ limit: "10mb" }));
const ingestRequestSchema = z.object({
    providerId: z.enum(providerIds),
    runId: z.string().min(1),
    startedAt: z.string().datetime().optional(),
    items: z.array(ledgerItemInputSchema),
    pdfs: z
        .array(z.object({
        localId: z.string().min(1),
        filename: z.string().min(1),
        contentType: z.string().min(1),
        bytesBase64: z.string().min(1)
    }))
        .optional()
});
const exportQuerySchema = z.object({
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    providerId: z.enum(providerIds).optional()
});
const MIN_INGEST_INTERVAL_MS = 15_000;
function asyncHandler(fn) {
    return (req, res, next) => {
        fn(req, res, next).catch(next);
    };
}
function hashToken(token) {
    return createHash("sha256").update(token).digest("hex");
}
async function requireFirebaseAuth(req, res, next) {
    const authHeader = req.header("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) {
        res.status(401).json({ error: "Missing auth token" });
        return;
    }
    try {
        const decoded = await getAuth().verifyIdToken(token);
        req.user = { uid: decoded.uid, email: decoded.email };
        next();
    }
    catch (error) {
        res.status(401).json({ error: "Invalid auth token" });
    }
}
async function resolveIngestionToken(token) {
    const tokenHash = hashToken(token);
    const doc = await db.collection("ingestionTokens").doc(tokenHash).get();
    if (!doc.exists) {
        return null;
    }
    const data = doc.data();
    return data?.uid ?? null;
}
async function enforceRateLimit(uid, providerId) {
    const docRef = db.collection("users").doc(uid).collection("rateLimits").doc(providerId);
    const snapshot = await docRef.get();
    const now = Date.now();
    const last = snapshot.exists ? snapshot.data()?.lastIngestAtMs : undefined;
    if (last && now - last < MIN_INGEST_INTERVAL_MS) {
        throw new Error("Rate limit exceeded");
    }
    await docRef.set({
        lastIngestAtMs: now,
        updatedAt: new Date(now).toISOString()
    }, { merge: true });
}
async function deleteCollection(query) {
    const snapshot = await query.limit(300).get();
    if (snapshot.empty) {
        return;
    }
    const batch = db.batch();
    snapshot.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    await deleteCollection(query);
}
async function deleteReceipts(uid) {
    const bucket = storage.bucket();
    const [files] = await bucket.getFiles({ prefix: `receipts/${uid}/` });
    await Promise.all(files.map((file) => file.delete().catch(() => undefined)));
}
app.get("/api/health", asyncHandler(async (_req, res) => {
    res.json({ ok: true });
}));
app.post("/api/token/generate", requireFirebaseAuth, asyncHandler(async (req, res) => {
    const uid = req.user?.uid;
    if (!uid) {
        res.status(401).json({ error: "Unauthorized" });
        return;
    }
    const token = randomBytes(32).toString("hex");
    const tokenHash = hashToken(token);
    const nowIso = new Date().toISOString();
    const tokenDocRef = db.collection("users").doc(uid).collection("secrets").doc("ingestionToken");
    const existing = await tokenDocRef.get();
    const existingHash = existing.exists ? existing.data()?.hash : undefined;
    if (existingHash && existingHash !== tokenHash) {
        await db.collection("ingestionTokens").doc(existingHash).delete();
    }
    await tokenDocRef.set({ hash: tokenHash, createdAt: nowIso }, { merge: true });
    await db
        .collection("ingestionTokens")
        .doc(tokenHash)
        .set({ uid, createdAt: nowIso }, { merge: true });
    res.json({ token });
}));
app.post("/api/ingest", asyncHandler(async (req, res) => {
    const token = req.header("x-aicostledger-token") || req.header("X-AICOSTLEDGER-TOKEN");
    if (!token) {
        res.status(401).json({ error: "Missing ingestion token" });
        return;
    }
    const uid = await resolveIngestionToken(token);
    if (!uid) {
        res.status(401).json({ error: "Invalid ingestion token" });
        return;
    }
    const parsed = ingestRequestSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
        return;
    }
    const { providerId, runId, startedAt, items, pdfs } = parsed.data;
    for (const item of items) {
        if (item.providerId !== providerId) {
            res.status(400).json({ error: "Provider mismatch in items" });
            return;
        }
    }
    try {
        await enforceRateLimit(uid, providerId);
    }
    catch (error) {
        res.status(429).json({ error: "Rate limit exceeded" });
        return;
    }
    const pdfMap = new Map();
    if (pdfs && pdfs.length > 0) {
        const bucket = storage.bucket();
        for (const pdf of pdfs) {
            const buffer = Buffer.from(pdf.bytesBase64, "base64");
            const path = `receipts/${uid}/${providerId}/${pdf.localId}.pdf`;
            const file = bucket.file(path);
            await file.save(buffer, {
                metadata: {
                    contentType: pdf.contentType,
                    metadata: {
                        originalFilename: pdf.filename
                    }
                },
                resumable: false
            });
            pdfMap.set(pdf.localId, path);
        }
    }
    const ledgerRef = db.collection("users").doc(uid).collection("ledgerItems");
    const docRefs = items.map((item) => ledgerRef.doc(item.id));
    const existingDocs = docRefs.length > 0 ? await db.getAll(...docRefs) : [];
    const createdAtById = new Map();
    existingDocs.forEach((doc) => {
        if (!doc.exists) {
            return;
        }
        const createdAt = doc.data()?.createdAt;
        if (typeof createdAt === "string") {
            createdAtById.set(doc.id, createdAt);
        }
        else if (createdAt && typeof createdAt.toDate === "function") {
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
        const payload = {
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
        startedAt: startedAt ?? nowIso,
        endedAt: nowIso,
        status: "success",
        stats: {
            items: items.length,
            pdfs: pdfs?.length ?? 0
        }
    });
    const runRef = db.collection("users").doc(uid).collection("runs").doc(runId);
    await runRef.set(runLog, { merge: true });
    const connectorRef = db.collection("users").doc(uid).collection("connectors").doc(providerId);
    await connectorRef.set({
        providerId,
        lastRunAt: nowIso,
        lastRunId: runId,
        lastStatus: runLog.status
    }, { merge: true });
    res.json({ ok: true, items: items.length, pdfs: pdfs?.length ?? 0 });
}));
app.get("/api/export.csv", requireFirebaseAuth, asyncHandler(async (req, res) => {
    const uid = req.user?.uid;
    if (!uid) {
        res.status(401).json({ error: "Unauthorized" });
        return;
    }
    const parsed = exportQuerySchema.safeParse({
        from: typeof req.query.from === "string" ? req.query.from : undefined,
        to: typeof req.query.to === "string" ? req.query.to : undefined,
        providerId: typeof req.query.providerId === "string" ? req.query.providerId : undefined
    });
    if (!parsed.success) {
        res.status(400).json({ error: "Invalid query", details: parsed.error.flatten() });
        return;
    }
    const { from, to, providerId } = parsed.data;
    let query = db.collection("users").doc(uid).collection("ledgerItems");
    if (providerId) {
        query = query.where("providerId", "==", providerId);
    }
    if (from) {
        query = query.where("occurredAt", ">=", from);
    }
    if (to) {
        query = query.where("occurredAt", "<=", to);
    }
    const snapshot = await query.orderBy("occurredAt", "desc").get();
    const items = snapshot.docs.map((doc) => doc.data());
    const bucket = storage.bucket();
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=ledger.csv");
    res.write(`${csvColumns.join(",")}\n`);
    for (const item of items) {
        let receiptUrl = null;
        if (item.pdfStoragePath) {
            const [signedUrl] = await bucket.file(item.pdfStoragePath).getSignedUrl({
                action: "read",
                expires: Date.now() + 15 * 60 * 1000
            });
            receiptUrl = signedUrl;
        }
        const row = ledgerItemToCsvRow(item, receiptUrl);
        res.write(`${csvRowToLine(row)}\n`);
    }
    res.end();
}));
app.get("/api/receipts/:invoiceId/url", requireFirebaseAuth, asyncHandler(async (req, res) => {
    const uid = req.user?.uid;
    if (!uid) {
        res.status(401).json({ error: "Unauthorized" });
        return;
    }
    const invoiceId = req.params.invoiceId;
    if (!invoiceId) {
        res.status(400).json({ error: "Missing invoice id" });
        return;
    }
    const doc = await db
        .collection("users")
        .doc(uid)
        .collection("ledgerItems")
        .doc(invoiceId)
        .get();
    if (!doc.exists) {
        res.status(404).json({ error: "Invoice not found" });
        return;
    }
    const item = doc.data();
    if (!item.pdfStoragePath) {
        res.status(404).json({ error: "Receipt not available" });
        return;
    }
    const [signedUrl] = await storage.bucket().file(item.pdfStoragePath).getSignedUrl({
        action: "read",
        expires: Date.now() + 15 * 60 * 1000
    });
    res.json({ url: signedUrl });
}));
app.post("/api/data/delete", requireFirebaseAuth, asyncHandler(async (req, res) => {
    const uid = req.user?.uid;
    if (!uid) {
        res.status(401).json({ error: "Unauthorized" });
        return;
    }
    const userRef = db.collection("users").doc(uid);
    const tokenDoc = await userRef.collection("secrets").doc("ingestionToken").get();
    const tokenHash = tokenDoc.exists ? tokenDoc.data()?.hash : undefined;
    await deleteCollection(userRef.collection("ledgerItems"));
    await deleteCollection(userRef.collection("runs"));
    await deleteCollection(userRef.collection("connectors"));
    await deleteCollection(userRef.collection("rateLimits"));
    await deleteCollection(userRef.collection("secrets"));
    if (tokenHash) {
        await db.collection("ingestionTokens").doc(tokenHash).delete();
    }
    await deleteReceipts(uid);
    res.json({ ok: true });
}));
app.use((error, _req, res, _next) => {
    res.status(500).json({ error: "Server error", message: error.message });
});
export const api = onRequest({ region: "us-central1" }, app);
