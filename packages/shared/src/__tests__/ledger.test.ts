import { describe, expect, it } from "vitest";
import {
  csvRowToLine,
  ledgerItemToCsvRow,
  moneyToCents,
  stableId,
  type LedgerItem
} from "../index";

describe("shared helpers", () => {
  it("generates stable ids deterministically", () => {
    const id1 = stableId("openai_api", "2024-01-01T00:00:00Z", 1234, "USD", "INV-1");
    const id2 = stableId("openai_api", "2024-01-01T00:00:00Z", 1234, "USD", "INV-1");
    expect(id1).toBe(id2);
  });

  it("parses money to cents", () => {
    expect(moneyToCents("$12.34", "USD")).toBe(1234);
    expect(moneyToCents("1000", "JPY")).toBe(1000);
  });

  it("formats csv rows with quotes when needed", () => {
    const item: LedgerItem = {
      id: "abc",
      userId: "user",
      providerId: "cursor",
      occurredAt: "2024-01-01T00:00:00Z",
      amountCents: 999,
      currency: "USD",
      description: "Plan, monthly",
      source: "scrape",
      createdAt: "2024-01-01T00:00:00Z"
    };
    const row = ledgerItemToCsvRow(item, "https://example.com/receipt.pdf");
    const line = csvRowToLine(row);
    expect(line).toContain("\"Plan, monthly\"");
  });
});
