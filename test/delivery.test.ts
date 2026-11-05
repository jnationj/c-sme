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

describe("Ledger reports and customer stats", () => {
  const rep = (planId: string, payer: string | null, customer: bigint | null) => ({
    planId,
    question: "q",
    report: "r",
    writtenBy: "deepseek",
    payments: [{ title: "t", usd: "0.005", status: "settled", tx: null }],
    dataAtomic: 19000n,
    customerAtomic: customer,
    payer,
  });

  it("saves and reads back a report", () => {
    const l = new Ledger();
    l.saveReport(rep("p1", "0xABCDEF0000000000000000000000000000000001", 39000n));
    const r = l.getReport("p1");
    expect(r?.question).toBe("q");
    expect(r?.dataAtomic).toBe(19000n);
    expect(r?.payer).toBe("0xabcdef0000000000000000000000000000000001"); // stored lowercased
    expect(l.getReport("missing")).toBeUndefined();
  });

  it("aggregates repeat customers and ignores operator runs with no payer", () => {
    const l = new Ledger();
    const a = "0xaaaa000000000000000000000000000000000001";
    const b = "0xbbbb000000000000000000000000000000000002";
    l.saveReport(rep("p1", a, 39000n), 1000);
    l.saveReport(rep("p2", a, 41000n), 2000);
    l.saveReport(rep("p3", b, 39000n), 3000);
    l.saveReport(rep("p4", null, null), 4000);
    const stats = l.customerStats();
    expect(stats).toHaveLength(2);
    const sa = stats.find((x) => x.payer === a)!;
    expect(sa.runs).toBe(2);
    expect(sa.paidAtomic).toBe(80000n);
    expect(stats.find((x) => x.payer === b)!.runs).toBe(1);
  });
});

import { RunGate, isSelfPayment, isTxHash, parsePositiveInt, payerFromHeader } from "../src/agent/delivery.js";

describe("RunGate (Copilot review: concurrent runs must not bypass the unsettled cap)", () => {
  it("lets at most max concurrent runs in, even when requests arrive together", () => {
    const g = new RunGate(3);
    const results = Array.from({ length: 6 }, () => g.tryEnter(0));
    expect(results.filter(Boolean)).toHaveLength(3);
    expect(g.inFlight).toBe(3);
  });
  it("counts already-unsettled customer payments against the same limit", () => {
    const g = new RunGate(3);
    expect(g.tryEnter(2)).toBe(true); // 2 unsettled + 0 in flight < 3
    expect(g.tryEnter(2)).toBe(false); // 2 unsettled + 1 in flight = 3
  });
  it("frees a slot when a run leaves, and never goes negative", () => {
    const g = new RunGate(1);
    expect(g.tryEnter(0)).toBe(true);
    expect(g.tryEnter(0)).toBe(false);
    g.leave();
    g.leave();
    expect(g.inFlight).toBe(0);
    expect(g.tryEnter(0)).toBe(true);
  });
});

describe("isTxHash", () => {
  it("accepts only a 32-byte 0x hash", () => {
    expect(isTxHash("0x" + "a".repeat(64))).toBe(true);
    expect(isTxHash("0x123")).toBe(false);
    expect(isTxHash(undefined)).toBe(false);
    expect(isTxHash("a".repeat(66))).toBe(false);
  });
});

describe("parsePositiveInt", () => {
  it("uses the fallback when unset", () => {
    expect(parsePositiveInt("X", undefined, 3)).toBe(3);
    expect(parsePositiveInt("X", "", 3)).toBe(3);
  });
  it("parses valid values and rejects typos instead of silently disabling a limit", () => {
    expect(parsePositiveInt("X", "5", 3)).toBe(5);
    for (const bad of ["bad", "0", "-1", "2.5", "NaN"]) expect(() => parsePositiveInt("X", bad, 3)).toThrow();
  });
});

describe("self-payment guard (the facilitator refuses it only after we have bought data)", () => {
  const header = (from: string) => Buffer.from(JSON.stringify({ payload: { authorization: { from } } })).toString("base64");
  const AGENT = "0x8c3c14616972cC3B06d4E378D5e11a682fC49e35";
  it("reads the payer from a payment header", () => {
    expect(payerFromHeader(header("0xAbC"))).toBe("0xAbC");
    expect(payerFromHeader(undefined)).toBeNull();
    expect(payerFromHeader("garbage")).toBeNull();
    expect(payerFromHeader(Buffer.from(JSON.stringify({ nope: 1 })).toString("base64"))).toBeNull();
  });
  it("flags a payment from the receiving wallet, ignoring letter case", () => {
    expect(isSelfPayment(header(AGENT.toLowerCase()), AGENT)).toBe(true);
    expect(isSelfPayment(header(AGENT), AGENT.toLowerCase())).toBe(true);
  });
  it("lets any other payer through, and ignores requests without a readable header", () => {
    expect(isSelfPayment(header("0x1111111111111111111111111111111111111111"), AGENT)).toBe(false);
    expect(isSelfPayment(undefined, AGENT)).toBe(false);
    expect(isSelfPayment(header(AGENT), undefined)).toBe(false);
  });
});

describe("Ledger.countIncomingSince (the failure breaker must forget old failures)", () => {
  const row = (key: string) => ({ taskId: "t", direction: "in" as const, provider: "customer", token: "USAT", counterparty: "0x1", idempotencyKey: key, amount: 39000n });
  it("counts only recent failures", () => {
    const l = new Ledger();
    const now = Date.UTC(2026, 10, 6, 12);
    l.createPayment(row("old"), now - 3 * 3_600_000);
    l.createPayment(row("recent"), now - 600_000);
    l.setStatus("old", "failed", undefined, now);
    l.setStatus("recent", "failed", undefined, now);
    expect(l.countIncomingSince("failed", 3_600_000, now)).toBe(1);
    expect(l.countIncomingSince("failed", 4 * 3_600_000, now)).toBe(2);
  });
});
