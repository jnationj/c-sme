import { describe, expect, it } from "vitest";
import { evaluateSpend, type PolicyConfig, type PolicyState, type SpendRequest } from "../src/policy/engine.js";
import { formatUsd, parseUsd } from "../src/chain/tokens.js";

const cfg: PolicyConfig = {
  killSwitch: false,
  perCallCap: parseUsd("0.05"),
  perTaskCap: parseUsd("0.25"),
  dailyCap: parseUsd("1"),
  allowedProviders: new Set(["tikhub", "apify"]),
  allowedTokens: new Set(["USDC", "USAT"]),
};
const state: PolicyState = { taskSpent: 0n, daySpent: 0n, hasUncertainPayment: false, idempotencyKeyUsed: false };
const req = (over: Partial<SpendRequest> = {}): SpendRequest => ({
  taskId: "t1",
  provider: "tikhub",
  token: "USAT",
  quoted: parseUsd("0.005"),
  idempotencyKey: "k1",
  approval: { idempotencyKey: "k1", maxAmount: parseUsd("0.01"), token: "USAT" },
  ...over,
});
const reasons = (d: ReturnType<typeof evaluateSpend>) => (d.allow ? [] : d.reasons);

describe("evaluateSpend", () => {
  it("allows an approved, in-policy purchase", () => {
    expect(evaluateSpend(req(), cfg, state)).toEqual({ allow: true });
  });

  it("blocks everything when the kill switch is on", () => {
    expect(reasons(evaluateSpend(req(), { ...cfg, killSwitch: true }, state))).toContain("kill switch is on");
  });

  it("blocks a purchase with no approval", () => {
    expect(reasons(evaluateSpend(req({ approval: undefined }), cfg, state))).toContain("no user approval");
  });

  it("blocks when the quote is above what the user approved", () => {
    const d = evaluateSpend(req({ quoted: parseUsd("0.02") }), cfg, state);
    expect(reasons(d)).toContain("quote exceeds the amount the user approved");
  });

  it("blocks an approval that belongs to a different purchase or token", () => {
    const a = evaluateSpend(req({ approval: { idempotencyKey: "other", maxAmount: parseUsd("1"), token: "USAT" } }), cfg, state);
    expect(reasons(a)).toContain("approval is for a different purchase");
    const b = evaluateSpend(req({ approval: { idempotencyKey: "k1", maxAmount: parseUsd("1"), token: "USDC" } }), cfg, state);
    expect(reasons(b)).toContain("approval is for a different token");
  });

  it("enforces per-call, per-task and daily caps", () => {
    const big = req({ quoted: parseUsd("0.06"), approval: { idempotencyKey: "k1", maxAmount: parseUsd("1"), token: "USAT" } });
    expect(reasons(evaluateSpend(big, cfg, state))).toContain("exceeds per-call cap");
    expect(reasons(evaluateSpend(req(), cfg, { ...state, taskSpent: parseUsd("0.249") }))).toContain("exceeds per-task cap");
    expect(reasons(evaluateSpend(req(), cfg, { ...state, daySpent: parseUsd("0.999") }))).toContain("exceeds daily cap");
  });

  it("allows spend that lands exactly on a cap", () => {
    expect(evaluateSpend(req(), cfg, { ...state, taskSpent: parseUsd("0.245") })).toEqual({ allow: true });
  });

  it("rejects non-allowlisted providers and tokens", () => {
    expect(reasons(evaluateSpend(req({ provider: "shady" }), cfg, state))).toContain("provider not allowlisted: shady");
    expect(reasons(evaluateSpend(req({ token: "DAI" }), cfg, state))).toContain("token not allowed: DAI");
  });

  it("refuses further spend while an earlier payment is uncertain", () => {
    expect(reasons(evaluateSpend(req(), cfg, { ...state, hasUncertainPayment: true }))).toContain(
      "an earlier payment is uncertain: reconcile before spending",
    );
  });

  it("refuses a reused idempotency key", () => {
    expect(reasons(evaluateSpend(req(), cfg, { ...state, idempotencyKeyUsed: true }))).toContain("duplicate idempotency key");
  });

  it("rejects zero or negative quotes", () => {
    expect(reasons(evaluateSpend(req({ quoted: 0n }), cfg, state))).toContain("quoted amount must be positive");
  });

  it("collects every reason, not just the first", () => {
    const d = evaluateSpend(req({ provider: "shady", approval: undefined }), { ...cfg, killSwitch: true }, state);
    expect(reasons(d).length).toBeGreaterThanOrEqual(3);
  });
});

describe("money helpers", () => {
  it("parses and formats 6-decimal USD amounts", () => {
    expect(parseUsd("0.005")).toBe(5000n);
    expect(parseUsd("1")).toBe(1_000_000n);
    expect(formatUsd(5000n)).toBe("0.005");
    expect(formatUsd(2_000_000n)).toBe("2");
  });
  it("rejects malformed amounts", () => {
    for (const bad of ["-1", "1e3", "0.1234567", "abc", "", "1."]) expect(() => parseUsd(bad)).toThrow();
  });
});
