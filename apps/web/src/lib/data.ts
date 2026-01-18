import { collection, getDocs, orderBy, query } from "firebase/firestore";
import type { LedgerItem, ProviderId } from "@aicostledger/shared";
import { db } from "../firebase";

type ConnectorDoc = {
  providerId: ProviderId;
  lastRunAt?: string;
  lastStatus?: string;
  lastRunId?: string;
};

function normalizeDate(value: unknown) {
  if (typeof value === "string") {
    return value;
  }
  if (value && typeof (value as { toDate?: () => Date }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  return undefined;
}

export async function fetchLedgerItems(uid: string): Promise<LedgerItem[]> {
  const ledgerRef = collection(db, "users", uid, "ledgerItems");
  const ledgerQuery = query(ledgerRef, orderBy("occurredAt", "desc"));
  const snapshot = await getDocs(ledgerQuery);
  return snapshot.docs.map((doc) => {
    const data = doc.data() as LedgerItem;
    return {
      ...data,
      occurredAt: normalizeDate(data.occurredAt) ?? data.occurredAt,
      createdAt: normalizeDate(data.createdAt) ?? data.createdAt
    } as LedgerItem;
  });
}

export async function fetchConnectors(uid: string): Promise<ConnectorDoc[]> {
  const connectorRef = collection(db, "users", uid, "connectors");
  const connectorQuery = query(connectorRef, orderBy("providerId", "asc"));
  const snapshot = await getDocs(connectorQuery);
  return snapshot.docs.map((doc) => {
    const data = doc.data() as ConnectorDoc;
    return {
      ...data,
      lastRunAt: normalizeDate(data.lastRunAt)
    };
  });
}
