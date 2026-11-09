import { describe, expect, it } from "vitest";
import { x402Client } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { getAddress } from "viem";
import { TOKENS } from "../src/chain/tokens.js";
import { netConfigFor } from "../src/web/wallet.js";
import {
  GuardError,
  buildExpected,
  createPaymentGuard,
  createPaymentLock,
  createPlanRegistry,
  installGuard,
  parsePlanRequest,
  type PaySigner,
} from "../src/web/pay-guard.js";

// Everything here runs the REAL installed x402 client (2.29.0) with a FAKE signer: no wallet, no network, no funds.
// "signed" records every call that reached the original signer, i.e. every time a wallet would have been asked.

const ORIGIN = "https://c-sme-production.up.railway.app";
const PLAN = "0b6d3f2a-4c1e-4a57-9d3e-5f1a2b3c4d5e";
const OTHER_PLAN = "11111111-2222-4333-8444-555555555555";
const ACCT = "0x1234567890123456789012345678901234567890";
const PAY_TO = "0x2222222222222222222222222222222222222222";
const AMOUNT = 32000n; // 0.032 in 6-decimal token units
const SIG = ("0x" + "ab".repeat(65)) as `0x${string}`;
const USAT = TOKENS.USAT;

const net = netConfigFor(42220)!;
const plan = { id: PLAN, amount: AMOUNT };

type Req = {
  scheme: string;
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra: Record<string, unknown>;
};
const goodReq = (): Req => ({
  scheme: "exact",
  network: "eip155:42220",
  asset: USAT.address,
  amount: AMOUNT.toString(),
  payTo: PAY_TO,
  maxTimeoutSeconds: 120,
  extra: { name: USAT.eip712.name, version: USAT.eip712.version },
});
const paymentRequired = (req: Req, over: Record<string, unknown> = {}) =>
  ({ x402Version: 2, resource: { url: `http://c-sme-production.up.railway.app/api/run/${PLAN}`, description: "x", mimeType: "application/json" }, accepts: [req], ...over }) as any;

function fakeProvider(o: { accounts?: unknown; chainId?: unknown; failAccounts?: boolean; failChain?: boolean } = {}) {
  const s = { accounts: o.accounts ?? [ACCT], chainId: o.chainId ?? "0xa4ec", failAccounts: !!o.failAccounts, failChain: !!o.failChain, calls: [] as string[] };
  return Object.assign(s, {
    request: async ({ method }: { method: string }) => {
      s.calls.push(method);
      if (method === "eth_accounts") {
        if (s.failAccounts) throw new Error("rpc down");
        return s.accounts;
      }
      if (method === "eth_chainId") {
        if (s.failChain) throw new Error("rpc down");
        return s.chainId;
      }
      throw new Error("unexpected " + method);
    },
  });
}

function setup(o: { provider?: ReturnType<typeof fakeProvider>; connected?: string | null; now?: () => number } = {}) {
  const provider = o.provider ?? fakeProvider();
  const exp = buildExpected(net, PAY_TO, plan);
  const guard = createPaymentGuard(exp, ACCT, {
    provider,
    connectedAddress: () => (o.connected === undefined ? ACCT : o.connected),
    origin: ORIGIN,
    ...(o.now ? { now: o.now } : {}),
  });
  const signed: any[] = [];
  const inner: PaySigner = {
    address: ACCT as `0x${string}`,
    signTypedData: async (m) => {
      signed.push(m);
      return SIG;
    },
  };
  return { provider, exp, guard, inner, signed };
}

/** The production wiring, driven through the real x402 client. */
function realClient(s: ReturnType<typeof setup>) {
  const client = new x402Client();
  installGuard(client, s.guard, s.exp);
  registerExactEvmScheme(client, { signer: s.guard.wrapSigner(s.inner) });
  return client;
}

describe("payment guard with the real x402 client", () => {
  it("a valid x402 v2 exact payment reaches the original signer exactly once, with the expected typed data", async () => {
    const s = setup();
    const payload: any = await realClient(s).createPaymentPayload(paymentRequired(goodReq()));
    expect(s.signed).toHaveLength(1);
    const m = s.signed[0];
    expect(m.primaryType).toBe("TransferWithAuthorization");
    expect(m.domain).toEqual({ name: "Tether America USD", version: "1", chainId: 42220, verifyingContract: getAddress(USAT.address) });
    expect(m.message.value).toBe(AMOUNT);
    expect(m.message.validAfter).toBe(0n);
    expect(getAddress(m.message.to)).toBe(getAddress(PAY_TO));
    expect(payload.payload.signature).toBe(SIG);
    expect(payload.payload.authorization.value).toBe("32000");
  });

  const mismatches: Array<[string, (r: Req) => void, RegExp]> = [
    ["wrong network", (r) => (r.network = "eip155:1"), /spendControls|cpilot_guard:network/],
    ["testnet network on a mainnet page", (r) => (r.network = "eip155:11142220"), /spendControls|cpilot_guard:network/],
    ["a different asset (USDC)", (r) => (r.asset = TOKENS.USDC.address), /cpilot_guard:asset/],
    ["the 18-decimal fee adapter instead of the token", (r) => (r.asset = "0x0357EE22278c922e1D36cFe6b899269b161880C4"), /spendControls|cpilot_guard:asset/],
    ["a different recipient", (r) => (r.payTo = "0x3333333333333333333333333333333333333333"), /cpilot_guard:payTo/],
    ["a higher amount", (r) => (r.amount = "32001"), /spendControls|cpilot_guard:amount/],
    ["a lower amount (exact match required)", (r) => (r.amount = "31999"), /cpilot_guard:amount/],
    ["a non-numeric amount", (r) => (r.amount = "0.032"), /spendControls|cpilot_guard:amount|rejected|invalid/i],
    ["wrong EIP-712 name", (r) => (r.extra = { ...r.extra, name: "USDC" }), /cpilot_guard:domain/],
    ["wrong EIP-712 version", (r) => (r.extra = { ...r.extra, version: "2" }), /cpilot_guard:domain/],
    ["a Permit2 transfer method", (r) => (r.extra = { ...r.extra, assetTransferMethod: "permit2" }), /cpilot_guard:transfer/],
    ["a zero timeout", (r) => (r.maxTimeoutSeconds = 0), /cpilot_guard:timeout/],
    ["a timeout above the 300 s ceiling", (r) => (r.maxTimeoutSeconds = 301), /cpilot_guard:timeout/],
  ];
  for (const [name, mutate, expected] of mismatches) {
    it(`rejects ${name} before the wallet is asked to sign`, async () => {
      const s = setup();
      const r = goodReq();
      mutate(r);
      await expect(realClient(s).createPaymentPayload(paymentRequired(r))).rejects.toThrow(expected);
      expect(s.signed).toHaveLength(0);
      expect(s.provider.calls).toHaveLength(0); // not even the live wallet re-read: the requirements were already refused
    });
  }

  it("rejects a scheme that is not exact before signing", async () => {
    const s = setup();
    const r = goodReq();
    r.scheme = "upto";
    await expect(realClient(s).createPaymentPayload(paymentRequired(r))).rejects.toThrow();
    expect(s.signed).toHaveLength(0);
  });

  const resourceCases: Array<[string, unknown]> = [
    ["missing", undefined],
    ["without a url", {}],
    ["unparseable", { url: "http://" }],
    ["for a different plan", { url: `http://c-sme-production.up.railway.app/api/run/${OTHER_PLAN}` }],
    ["for a different route", { url: "http://c-sme-production.up.railway.app/api/plan" }],
    ["with a trailing slash", { url: `http://c-sme-production.up.railway.app/api/run/${PLAN}/` }],
  ];
  for (const [name, resource] of resourceCases) {
    it(`rejects a resource.url that is ${name}`, async () => {
      const s = setup();
      await expect(realClient(s).createPaymentPayload(paymentRequired(goodReq(), { resource }))).rejects.toThrow(/cpilot_guard:resource/);
      expect(s.signed).toHaveLength(0);
    });
  }

  it("accepts the same route under another scheme, host or query (the Railway proxy origin is unresolved)", async () => {
    for (const url of [`http://internal.railway.test/api/run/${PLAN}`, `https://example.test/api/run/${PLAN}?x=1`, `/api/run/${PLAN}`]) {
      const s = setup();
      await realClient(s).createPaymentPayload(paymentRequired(goodReq(), { resource: { url } }));
      expect(s.signed).toHaveLength(1);
    }
  });

  it("calls the original signer exactly once per valid request and never after an invalid one", async () => {
    const good = setup();
    await realClient(good).createPaymentPayload(paymentRequired(goodReq()));
    const bad = setup();
    const r = goodReq();
    r.payTo = "0x3333333333333333333333333333333333333333";
    await expect(realClient(bad).createPaymentPayload(paymentRequired(r))).rejects.toThrow();
    expect([good.signed.length, bad.signed.length]).toEqual([1, 0]);
  });
});

describe("hook on the requirements", () => {
  const ctx = (req: Req, pr = paymentRequired(req)) => ({ paymentRequired: pr, selectedRequirements: req as any });

  it("rejects x402 version 1 (the v1 scheme is registered on the same signer)", async () => {
    const s = setup();
    const out = await s.guard.hook(ctx(goodReq(), paymentRequired(goodReq(), { x402Version: 1 })));
    expect(out).toEqual({ abort: true, reason: "cpilot_guard:version" });
  });
  it("accepts a valid v2 requirement and remembers it", async () => {
    const s = setup();
    expect(await s.guard.hook(ctx(goodReq()))).toBeUndefined();
    expect(s.guard.accepted()?.amount).toBe("32000");
  });
  it("forgets a previously accepted requirement when a later one fails", async () => {
    const s = setup();
    await s.guard.hook(ctx(goodReq()));
    const r = goodReq();
    r.amount = "1";
    await s.guard.hook(ctx(r));
    expect(s.guard.accepted()).toBeNull();
  });
});

describe("signer wrapper (the last check before the wallet prompt)", () => {
  const NOW_MS = 1_700_000_000_000;
  const T = BigInt(NOW_MS / 1000);
  const typed = (over: { domain?: Record<string, unknown>; message?: Record<string, unknown>; primaryType?: string } = {}) => ({
    domain: { name: USAT.eip712.name, version: USAT.eip712.version, chainId: 42220, verifyingContract: getAddress(USAT.address), ...over.domain },
    types: { TransferWithAuthorization: [] },
    primaryType: over.primaryType ?? "TransferWithAuthorization",
    message: {
      from: getAddress(ACCT),
      to: getAddress(PAY_TO),
      value: AMOUNT,
      validAfter: 0n,
      validBefore: T + 120n,
      nonce: "0x" + "cd".repeat(32),
      ...over.message,
    },
  });
  async function armed(o: Parameters<typeof setup>[0] = {}) {
    const s = setup({ now: () => NOW_MS, ...o });
    expect(await s.guard.hook({ paymentRequired: paymentRequired(goodReq()), selectedRequirements: goodReq() as any })).toBeUndefined();
    return { ...s, signer: s.guard.wrapSigner(s.inner) };
  }

  it("passes a valid request through untouched: same object, original signer called once", async () => {
    const s = await armed();
    const m = typed();
    expect(await s.signer.signTypedData(m)).toBe(SIG);
    expect(s.signed).toHaveLength(1);
    expect(s.signed[0]).toBe(m); // the very same typed-data object: nothing rewritten
    expect(s.provider.calls).toEqual(["eth_accounts", "eth_chainId"]); // re-read live, immediately before signing
  });

  it("keeps the signer's address and shape", async () => {
    const s = await armed();
    expect(s.signer.address).toBe(ACCT);
    expect(typeof s.signer.signTypedData).toBe("function");
  });

  it("refuses to sign if the hook never validated the requirements", async () => {
    const s = setup({ now: () => NOW_MS });
    await expect(s.guard.wrapSigner(s.inner).signTypedData(typed())).rejects.toThrow(/cpilot_guard:not_validated/);
    expect(s.signed).toHaveLength(0);
  });

  const typedMismatch: Array<[string, ReturnType<typeof typed>, RegExp]> = [
    ["a different primary type (Permit2)", typed({ primaryType: "PermitWitnessTransferFrom" }), /:type/],
    ["a different domain chain id", typed({ domain: { chainId: 1 } }), /:domain/],
    ["a different verifying contract", typed({ domain: { verifyingContract: getAddress(TOKENS.USDC.address) } }), /:domain/],
    ["a different domain name", typed({ domain: { name: "USDC" } }), /:domain/],
    ["a different domain version", typed({ domain: { version: "2" } }), /:domain/],
    ["a different recipient", typed({ message: { to: getAddress("0x3333333333333333333333333333333333333333") } }), /:payTo/],
    ["a higher value", typed({ message: { value: AMOUNT + 1n } }), /:amount/],
    ["a lower value", typed({ message: { value: AMOUNT - 1n } }), /:amount/],
    ["a payer that is not the payFetch address", typed({ message: { from: getAddress("0x4444444444444444444444444444444444444444") } }), /:account/],
    ["a malformed nonce", typed({ message: { nonce: "0x1234" } }), /:type/],
  ];
  for (const [name, m, expected] of typedMismatch) {
    it(`rejects ${name} before the wallet is asked`, async () => {
      const s = await armed();
      await expect(s.signer.signTypedData(m)).rejects.toThrow(expected);
      expect(s.signed).toHaveLength(0);
      expect(s.provider.calls).toHaveLength(0);
    });
  }

  const timestamps: Array<[string, Record<string, unknown>, boolean]> = [
    ["valid: window equals maxTimeoutSeconds", { validBefore: T + 120n }, true],
    ["valid: window 10 s short of maxTimeoutSeconds (tolerance)", { validBefore: T + 110n }, true],
    ["valid: strings of digits are read as BigInt", { validAfter: "0", validBefore: String(T + 120n) }, true],
    ["valid: validAfter already in the past", { validAfter: T - 5n }, true],
    ["rejects validAfter in the future", { validAfter: T + 1n }, false],
    ["rejects a negative validAfter", { validAfter: -1n }, false],
    ["rejects validBefore already passed", { validBefore: T - 1n }, false],
    ["rejects validBefore equal to now", { validBefore: T }, false],
    ["rejects a window longer than maxTimeoutSeconds", { validBefore: T + 121n }, false],
    ["rejects a window more than 10 s shorter", { validBefore: T + 109n }, false],
    ["rejects a non-numeric timestamp", { validBefore: "soon" }, false],
    ["rejects a missing timestamp", { validBefore: undefined }, false],
  ];
  for (const [name, message, ok] of timestamps) {
    it(`timestamps: ${name}`, async () => {
      const s = await armed();
      const m = typed({ message });
      if (ok) {
        await s.signer.signTypedData(m);
        expect(s.signed).toHaveLength(1);
        expect(s.signed[0]).toBe(m); // timestamps pass through unchanged
      } else {
        await expect(s.signer.signTypedData(m)).rejects.toThrow(/cpilot_guard:timestamp/);
        expect(s.signed).toHaveLength(0);
      }
    });
  }

  it("rejects when the live account is no longer the account being used", async () => {
    const s = await armed({ provider: fakeProvider({ accounts: ["0x4444444444444444444444444444444444444444"] }) });
    await expect(s.signer.signTypedData(typed())).rejects.toThrow(/cpilot_guard:account/);
    expect(s.signed).toHaveLength(0);
  });
  it("rejects when the wallet reports no accounts", async () => {
    const s = await armed({ provider: fakeProvider({ accounts: [] }) });
    await expect(s.signer.signTypedData(typed())).rejects.toThrow(/cpilot_guard:account/);
    expect(s.signed).toHaveLength(0);
  });
  it("rejects when eth_accounts cannot be read (fails closed)", async () => {
    const s = await armed({ provider: fakeProvider({ failAccounts: true }) });
    await expect(s.signer.signTypedData(typed())).rejects.toThrow(/cpilot_guard:account/);
    expect(s.signed).toHaveLength(0);
  });
  it("rejects when cPilot's own wallet state holds a different account", async () => {
    const s = await armed({ connected: "0x4444444444444444444444444444444444444444" });
    await expect(s.signer.signTypedData(typed())).rejects.toThrow(/cpilot_guard:account/);
    expect(s.signed).toHaveLength(0);
  });
  it("rejects when cPilot's wallet state has no account", async () => {
    const s = await armed({ connected: null });
    await expect(s.signer.signTypedData(typed())).rejects.toThrow(/cpilot_guard:account/);
    expect(s.signed).toHaveLength(0);
  });
  it("rejects when the live chain is not the approved network (hex, decimal and unreadable)", async () => {
    for (const chainId of ["0x1", "11142220", "nonsense"]) {
      const s = await armed({ provider: fakeProvider({ chainId }) });
      await expect(s.signer.signTypedData(typed())).rejects.toThrow(/cpilot_guard:chain/);
      expect(s.signed).toHaveLength(0);
    }
    const down = await armed({ provider: fakeProvider({ failChain: true }) });
    await expect(down.signer.signTypedData(typed())).rejects.toThrow(/cpilot_guard:chain/);
    expect(down.signed).toHaveLength(0);
  });
  it("accepts the approved chain whether the wallet reports it as hex or decimal", async () => {
    for (const chainId of ["0xa4ec", "42220", 42220]) {
      const s = await armed({ provider: fakeProvider({ chainId }) });
      await s.signer.signTypedData(typed());
      expect(s.signed).toHaveLength(1);
    }
  });
});

describe("request URL to plan id", () => {
  const post = { method: "POST" };
  it("accepts a relative or same-origin absolute POST to /api/run/<lowercase uuid>", () => {
    expect(parsePlanRequest(`/api/run/${PLAN}`, post, ORIGIN)).toBe(PLAN);
    expect(parsePlanRequest(`${ORIGIN}/api/run/${PLAN}`, post, ORIGIN)).toBe(PLAN);
    expect(parsePlanRequest(`/api/run/${PLAN}`, { method: "post" }, ORIGIN)).toBe(PLAN);
  });
  const bad: Array<[string, string, { method?: string } | undefined]> = [
    ["no method", `/api/run/${PLAN}`, undefined],
    ["GET", `/api/run/${PLAN}`, { method: "GET" }],
    ["another origin", `https://evil.example/api/run/${PLAN}`, post],
    ["a protocol-relative URL to another host", `//evil.example/api/run/${PLAN}`, post],
    ["a query string", `/api/run/${PLAN}?x=1`, post],
    ["an empty query marker", `/api/run/${PLAN}?`, post],
    ["a hash", `/api/run/${PLAN}#x`, post],
    ["a trailing slash", `/api/run/${PLAN}/`, post],
    ["an extra path segment", `/api/run/${PLAN}/extra`, post],
    ["another route", `/api/plan`, post],
    ["a missing id", `/api/run/`, post],
    ["an uppercase uuid", `/api/run/${PLAN.toUpperCase()}`, post],
    ["a malformed uuid", `/api/run/not-a-uuid`, post],
    ["an encoded character in the id", `/api/run/${PLAN.slice(0, 35)}%65`, post],
    ["credentials in the URL", `https://user:pw@c-sme-production.up.railway.app/api/run/${PLAN}`, post],
    ["a path traversal", `/api/run/../run/${PLAN}`, post],
  ];
  for (const [name, url, init] of bad) {
    it(`rejects ${name}`, () => {
      expect(() => parsePlanRequest(url, init, ORIGIN)).toThrow(/cpilot_guard:bad_request/);
    });
  }
});

describe("approved plan registry", () => {
  it("registers a plan and consumes it when payment starts", () => {
    const reg = createPlanRegistry();
    reg.set(PLAN, "0.032");
    expect(reg.peek()).toEqual({ id: PLAN, amount: 32000n });
    expect(reg.take(PLAN)).toEqual({ id: PLAN, amount: 32000n });
    expect(() => reg.take(PLAN)).toThrow(/plan_missing/);
  });
  it("rejects payment with no registered plan", () => {
    expect(() => createPlanRegistry().take(PLAN)).toThrow(/plan_missing/);
  });
  it("rejects a plan id that differs from the registered one, and keeps the registration", () => {
    const reg = createPlanRegistry();
    reg.set(PLAN, "0.032");
    expect(() => reg.take(OTHER_PLAN)).toThrow(/plan_mismatch/);
    expect(reg.peek()?.id).toBe(PLAN);
  });
  it("a newly shown plan replaces the earlier one", () => {
    const reg = createPlanRegistry();
    reg.set(PLAN, "0.032");
    reg.set(OTHER_PLAN, "0.05");
    expect(() => reg.take(PLAN)).toThrow(/plan_mismatch/);
    expect(reg.take(OTHER_PLAN).amount).toBe(50000n);
  });
  it("clear() removes the registration (new question or reset)", () => {
    const reg = createPlanRegistry();
    reg.set(PLAN, "0.032");
    reg.clear();
    expect(() => reg.take(PLAN)).toThrow(/plan_missing/);
  });
  it("an invalid id or price clears the registration and throws", () => {
    const reg = createPlanRegistry();
    reg.set(PLAN, "0.032");
    for (const [id, usd] of [[PLAN, "0"], [PLAN, "abc"], [PLAN, "1e3"], [PLAN, "0.0000001"], [PLAN, "-1"], [PLAN, ""], ["nope", "0.032"], [PLAN.toUpperCase(), "0.032"]] as const) {
      reg.set(PLAN, "0.032");
      expect(() => reg.set(id, usd)).toThrow(/plan_invalid/);
      expect(reg.peek()).toBeNull();
    }
  });
  it("reads the price exactly (no floating point)", () => {
    const reg = createPlanRegistry();
    for (const [usd, atomic] of [["0.1", 100000n], ["0.3", 300000n], ["0.032", 32000n], ["1", 1000000n], ["0.000001", 1n], ["12.345678", 12345678n]] as const) {
      reg.set(PLAN, usd);
      expect(reg.peek()?.amount).toBe(atomic);
    }
  });
});

describe("one payment at a time", () => {
  it("refuses a second payment while one is in progress", () => {
    const lock = createPaymentLock();
    expect(lock.tryAcquire()).toBe(true);
    expect(lock.tryAcquire()).toBe(false);
    lock.release();
    expect(lock.tryAcquire()).toBe(true);
  });
});

describe("GuardError", () => {
  it("carries a code and a message that survives x402's own error wrapping", () => {
    const e = new GuardError("amount");
    expect(e.code).toBe("amount");
    expect(`Failed to create payment payload: ${e.message}`).toMatch(/cpilot_guard:amount/);
  });
});
