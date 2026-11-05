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
