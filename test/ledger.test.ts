import { describe, expect, it } from "vitest";
import { Ledger, startOfUtcDay } from "../src/ledger/ledger.js";

const base = { taskId: "t1", direction: "out" as const, provider: "tikhub", token: "USAT", counterparty: null };

describe("Ledger", () => {
  it("rejects a duplicate idempotency key (duplicate-payment guard)", () => {
    const l = new Ledger();
    l.createPayment({ ...base, idempotencyKey: "k1", amount: 5000n });
    expect(() => l.createPayment({ ...base, idempotencyKey: "k1", amount: 5000n })).toThrow();
    expect(l.keyUsed("k1")).toBe(true);
    expect(l.keyUsed("nope")).toBe(false);
  });

  it("sums spend per task and per day, ignoring failed payments but counting uncertain ones", () => {
    const l = new Ledger();
    const now = Date.UTC(2026, 10, 5, 12);
    l.createPayment({ ...base, idempotencyKey: "a", amount: 5000n }, now);
    l.createPayment({ ...base, idempotencyKey: "b", amount: 7000n }, now);
    l.createPayment({ ...base, idempotencyKey: "c", amount: 9000n }, now);
    l.createPayment({ ...base, taskId: "t2", idempotencyKey: "d", amount: 1000n }, now);
    l.setStatus("b", "failed", undefined, now);
    l.setStatus("c", "uncertain", undefined, now);
    expect(l.spentForTask("t1")).toBe(14000n); // a + c
    expect(l.spentSince(startOfUtcDay(now))).toBe(15000n); // a + c + d
    expect(l.spentSince(startOfUtcDay(now) + 86_400_000)).toBe(0n);
  });

  it("does not count incoming payments as spend", () => {
    const l = new Ledger();
    l.createPayment({ ...base, direction: "in", idempotencyKey: "in1", amount: 2_000_000n });
    expect(l.spentSince(0)).toBe(0n);
  });

  it("tracks uncertain payments and tx hashes", () => {
    const l = new Ledger();
    l.createPayment({ ...base, idempotencyKey: "k", amount: 5000n });
    expect(l.hasUncertain()).toBe(false);
    l.setStatus("k", "uncertain");
    expect(l.hasUncertain()).toBe(true);
    l.setStatus("k", "settled", "0xabc");
    expect(l.hasUncertain()).toBe(false);
    expect(l.getPayment("k")).toMatchObject({ status: "settled", txHash: "0xabc", amount: 5000n });
  });

  it("errors when updating an unknown payment and writes an audit trail", () => {
    const l = new Ledger();
    expect(() => l.setStatus("ghost", "settled")).toThrow();
    l.createPayment({ ...base, idempotencyKey: "k", amount: 1n });
    const n = (l.db.prepare("SELECT COUNT(*) AS n FROM events").get() as { n: number }).n;
    expect(n).toBeGreaterThan(0);
  });
});
