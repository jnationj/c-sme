import { describe, expect, it } from "vitest";
import { directFailureMayHavePaid } from "../src/agent/payDirect.js";

describe("directFailureMayHavePaid (an uncertain payment freezes all spending, so be exact)", () => {
  it("nothing sent means nothing can have been paid", () => {
    expect(directFailureMayHavePaid({ paymentSent: false })).toBe(false);
    expect(directFailureMayHavePaid({ paymentSent: false, status: 500 })).toBe(false);
  });
  it("a 402 after sending is a rejected payment (for example an unfunded wallet), not a settlement", () => {
    expect(directFailureMayHavePaid({ paymentSent: true, status: 402 })).toBe(false);
  });
  it("the gateway saying paymentSettled:false is trusted", () => {
    expect(directFailureMayHavePaid({ paymentSent: true, status: 502, paymentSettledFlag: false })).toBe(false);
  });
  it("a sent payment with a timeout or an unexplained server error may have settled", () => {
    expect(directFailureMayHavePaid({ paymentSent: true })).toBe(true);
    expect(directFailureMayHavePaid({ paymentSent: true, status: 500 })).toBe(true);
    expect(directFailureMayHavePaid({ paymentSent: true, status: 200 })).toBe(true);
  });
});

import { noReportMessage } from "../src/agent/orchestrator.js";

describe("noReportMessage", () => {
  it("explains the sandbox daily allowance and says nothing was charged", () => {
    const m = noReportMessage([{ status: "failed", note: "sandbox_payer_budget_exhausted: not charged=true" }]);
    expect(m).toMatch(/daily data allowance/);
    expect(m).toMatch(/Nothing was charged/);
  });
  it("explains an unfunded wallet", () => {
    expect(noReportMessage([{ status: "failed", note: "verify_payment_failed: Onchain balance is not enough to cover the payment" }])).toMatch(/enough funds/);
  });
  it("explains a safety-rule block", () => {
    expect(noReportMessage([{ status: "blocked" }])).toMatch(/safety rules/);
  });
  it("has a plain default", () => {
    expect(noReportMessage([{ status: "failed", note: "provider_error" }])).toMatch(/No data could be bought/);
    expect(noReportMessage([])).toMatch(/Nothing was charged/);
  });
});
