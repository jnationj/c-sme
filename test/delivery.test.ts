import { describe, expect, it } from "vitest";
import { decodeSettlement, hasDeliverable } from "../src/agent/delivery.js";
import { Ledger } from "../src/ledger/ledger.js";

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64");

describe("hasDeliverable (Finding 1: never charge the customer for no report)", () => {
  it("is false when every purchase failed, was blocked or is uncertain", () => {
    expect(hasDeliverable([])).toBe(false);
    expect(hasDeliverable([{ status: "failed" }, { status: "blocked" }])).toBe(false);
    expect(hasDeliverable([{ status: "uncertain" }])).toBe(false);
  });
  it("is true when at least one purchase settled", () => {
    expect(hasDeliverable([{ status: "failed" }, { status: "settled" }])).toBe(true);
  });
});

describe("decodeSettlement", () => {
  it("reads a successful settlement", () => {
    expect(decodeSettlement(b64({ success: true, transaction: "0xabc", payer: "0x1" }))).toEqual({ success: true, transaction: "0xabc", payer: "0x1" });
  });
  it("reads a failed settlement", () => {
    expect(decodeSettlement(b64({ success: false }))?.success).toBe(false);
  });
  it("returns undefined for missing or malformed headers", () => {
    expect(decodeSettlement(undefined)).toBeUndefined();
    expect(decodeSettlement(null)).toBeUndefined();
    expect(decodeSettlement("not-base64-json")).toBeUndefined();
    expect(decodeSettlement(b64({ nope: 1 }))).toBeUndefined();
  });
});

describe("Ledger.countIncoming (Finding 2: bound exposure to unsettled customer payments)", () => {
  const inRow = (key: string) => ({ taskId: "t", direction: "in" as const, provider: "customer", token: "USDC", counterparty: "0x1", idempotencyKey: key, amount: 39000n });

  it("counts only incoming payments in the requested status", () => {
    const l = new Ledger();
    l.createPayment(inRow("a"));
    l.createPayment(inRow("b"));
    l.createPayment({ ...inRow("c"), direction: "out" });
    l.setStatus("a", "failed");
    l.setStatus("b", "settled", "0xtx");
    l.setStatus("c", "failed");
    expect(l.countIncoming("failed")).toBe(1); // outgoing failures are not customer settlements
    expect(l.countIncoming("settled")).toBe(1);
  });

  it("treats recent submitted payments as not yet overdue, old ones as unconfirmed", () => {
    const l = new Ledger();
    const now = Date.UTC(2026, 10, 6, 12);
    l.createPayment(inRow("old"), now - 10 * 60_000);
    l.createPayment(inRow("fresh"), now - 30_000);
    l.setStatus("old", "submitted", undefined, now);
    l.setStatus("fresh", "submitted", undefined, now);
    expect(l.countIncoming("submitted", 5 * 60_000, now)).toBe(1);
  });
});
