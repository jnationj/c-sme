import { describe, expect, it } from "vitest";
import { RateLimiter, clientIp } from "../src/agent/ratelimit.js";

describe("RateLimiter", () => {
  it("allows up to the limit then blocks, per key", () => {
    const r = new RateLimiter(3, 1000);
    expect([1, 2, 3, 4].map(() => r.allow("a", 0))).toEqual([true, true, true, false]);
    expect(r.allow("b", 0)).toBe(true); // another visitor is unaffected
  });
  it("frees capacity once hits leave the window", () => {
    const r = new RateLimiter(2, 1000);
    r.allow("a", 0);
    r.allow("a", 100);
    expect(r.allow("a", 500)).toBe(false);
    expect(r.allow("a", 1101)).toBe(true); // the first hit (t=0) has expired
  });
  it("does not count blocked attempts against the visitor", () => {
    const r = new RateLimiter(1, 1000);
    r.allow("a", 0);
    for (let t = 1; t < 50; t++) r.allow("a", t); // hammering while blocked
    expect(r.allow("a", 1001)).toBe(true);
  });
});

describe("clientIp", () => {
  const h = (m: Record<string, string>) => (n: string) => m[n];
  it("uses the first X-Forwarded-For entry", () => {
    expect(clientIp(h({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }))).toBe("1.2.3.4");
  });
  it("falls back to X-Real-IP, then a shared bucket", () => {
    expect(clientIp(h({ "x-real-ip": "5.6.7.8" }))).toBe("5.6.7.8");
    expect(clientIp(h({}))).toBe("unknown");
  });
});
