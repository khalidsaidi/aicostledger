import { collection, getDocs, orderBy, query } from "firebase/firestore";
import { db } from "../firebase";
function normalizeDate(value) {
    if (typeof value === "string") {
        return value;
    }
    if (value && typeof value.toDate === "function") {
        return value.toDate().toISOString();
    }
    return undefined;
}
export async function fetchLedgerItems(uid) {
    const ledgerRef = collection(db, "users", uid, "ledgerItems");
    const ledgerQuery = query(ledgerRef, orderBy("occurredAt", "desc"));
    const snapshot = await getDocs(ledgerQuery);
    return snapshot.docs.map((doc) => {
        const data = doc.data();
        return {
            ...data,
            occurredAt: normalizeDate(data.occurredAt) ?? data.occurredAt,
            createdAt: normalizeDate(data.createdAt) ?? data.createdAt
        };
    });
}
export async function fetchConnectors(uid) {
    const connectorRef = collection(db, "users", uid, "connectors");
    const connectorQuery = query(connectorRef, orderBy("providerId", "asc"));
    const snapshot = await getDocs(connectorQuery);
    return snapshot.docs.map((doc) => {
        const data = doc.data();
        return {
            ...data,
            lastRunAt: normalizeDate(data.lastRunAt)
        };
    });
}
