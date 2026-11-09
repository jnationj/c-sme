// Client-side payment guard for the existing x402 flow (Stage 1). A UX safeguard, NOT a security boundary:
// the server (price, asset, recipient, verification, settlement) stays authoritative, and the page, the plan and
// /api/config all come from that same server.
//
// It adds checks only. It never builds, rewrites or extends the payment, the typed data or any timestamp.
// Layers, all before the wallet is asked to sign:
//   1. x402Client spend control: the library itself refuses an amount above the approved price.
//   2. onBeforePaymentCreation hook: validates the 402's selected requirements (x402 v2, exact, network, asset,
//      payTo, exact amount, EIP-712 name/version, no Permit2, timeout, resource path).
//   3. Signer wrapper: validates the typed data actually about to be signed and re-reads eth_accounts and eth_chainId.
// Known limit: between the live re-read and the wallet's own prompt there is a small window we cannot close.
import type { BeforePaymentCreationHook, PaymentCreationContext, x402Client } from "@x402/core/client";
import { parseUsd, type Token } from "../chain/tokens.js";
import { isAddress, parseChainId, type Eip1193Provider, type NetConfig } from "./wallet.js";

export type GuardCode =
  | "version" | "scheme" | "network" | "asset" | "payTo" | "amount" | "domain" | "transfer" | "timeout" | "resource"
  | "type" | "timestamp" | "account" | "chain" | "not_validated"
  | "plan_missing" | "plan_mismatch" | "plan_invalid" | "bad_request" | "config" | "busy";

/** The message always carries "cpilot_guard:<code>" so it survives x402's own error wrapping and can be mapped to plain words. */
export class GuardError extends Error {
  constructor(readonly code: GuardCode) {
    super("cpilot_guard:" + code);
    this.name = "GuardError";
  }
}

/** Client policy ceiling for the authorisation window. The server currently asks for 120 s; this is only an upper bound. */
export const MAX_TIMEOUT_CEILING_SECONDS = 300;
/** How far the validity window may differ from maxTimeoutSeconds (seconds). */
export const WINDOW_TOLERANCE_SECONDS = 10n;

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const UUID_RE = new RegExp("^" + UUID + "$");
const PLAN_PATH_RE = new RegExp("^/api/run/(" + UUID + ")$");

/* ---------- request URL -> plan id ---------- */

/** Accepts only a same-origin POST to exactly /api/run/<lowercase uuid>. Returns the plan id, or throws. */
export function parsePlanRequest(url: string, init: { method?: string } | undefined, origin: string): string {
  if (typeof url !== "string" || /[?#]/.test(url)) throw new GuardError("bad_request");
  if (String(init?.method ?? "").toUpperCase() !== "POST") throw new GuardError("bad_request");
  let u: URL;
  let base: URL;
  try {
    base = new URL(origin);
    u = new URL(url, base);
  } catch {
    throw new GuardError("bad_request");
  }
  if (u.origin !== base.origin || u.username || u.password || u.search || u.hash) throw new GuardError("bad_request");
  // The URL must already be in canonical form: no dot-segments, no percent-encoded characters that normalise away.
  if (url !== u.pathname && url !== u.origin + u.pathname) throw new GuardError("bad_request");
  const m = PLAN_PATH_RE.exec(u.pathname);
  if (!m || !m[1]) throw new GuardError("bad_request");
  return m[1];
}

/* ---------- the approved plan: registered when the plan is shown, consumed when payment starts ---------- */

export interface ApprovedPlan {
  id: string;
  /** Exact customer price in token units (6 decimals), from the displayed USD string. */
  amount: bigint;
}

export function createPlanRegistry() {
  let current: ApprovedPlan | null = null;
  return {
    /** Replaces any earlier plan. An invalid id or price clears the registration and throws. */
    set(id: string, customerUsd: string): void {
      current = null;
      if (typeof id !== "string" || !UUID_RE.test(id)) throw new GuardError("plan_invalid");
      let amount: bigint;
      try {
        amount = parseUsd(customerUsd);
      } catch {
        throw new GuardError("plan_invalid");
      }
      if (amount <= 0n) throw new GuardError("plan_invalid");
      current = { id, amount };
    },
    clear(): void {
      current = null;
    },
    peek(): ApprovedPlan | null {
      return current;
    },
    /** Returns the plan for this id and consumes it. A different or missing registration throws (and a mismatch keeps the registration). */
    take(id: string): ApprovedPlan {
      if (!current) throw new GuardError("plan_missing");
      if (current.id !== id) throw new GuardError("plan_mismatch");
      const p = current;
      current = null;
      return p;
    },
  };
}

/** One payment at a time. */
export function createPaymentLock() {
  let held = false;
  return {
    tryAcquire(): boolean {
      if (held) return false;
      held = true;
      return true;
    },
    release(): void {
      held = false;
    },
    get held(): boolean {
      return held;
    },
  };
}

/* ---------- what we expect the 402 and the signature to say ---------- */

export interface Expected {
  planId: string;
  chainId: number;
  network: string; // CAIP-2, e.g. eip155:42220
  token: Token;
  payTo: string; // lowercase, validated
  amount: bigint;
}

export function buildExpected(net: NetConfig, agentWallet: string, plan: ApprovedPlan): Expected {
  if (!isAddress(agentWallet)) throw new GuardError("config");
  return { planId: plan.id, chainId: net.chainId, network: "eip155:" + net.chainId, token: net.token, payTo: agentWallet.toLowerCase(), amount: plan.amount };
}

type Requirements = PaymentCreationContext["selectedRequirements"];
const lc = (v: unknown): string => (typeof v === "string" ? v.toLowerCase() : "");

/** Throws GuardError unless the selected 402 requirement is exactly what the customer approved. */
export function validateRequirements(ctx: PaymentCreationContext, exp: Expected, origin: string): Requirements {
  const pr = ctx.paymentRequired;
  const r = ctx.selectedRequirements;
  if (pr.x402Version !== 2) throw new GuardError("version");
  if (r.scheme !== "exact") throw new GuardError("scheme");
  if (r.network !== exp.network) throw new GuardError("network");
  if (lc(r.asset) !== exp.token.address.toLowerCase()) throw new GuardError("asset");
  if (lc(r.payTo) !== exp.payTo) throw new GuardError("payTo");
  if (typeof r.amount !== "string" || !/^\d+$/.test(r.amount) || BigInt(r.amount) !== exp.amount) throw new GuardError("amount");
  const extra = r.extra as Record<string, unknown> | null | undefined;
  if (!extra || typeof extra !== "object") throw new GuardError("domain");
  if (extra.name !== exp.token.eip712.name || extra.version !== exp.token.eip712.version) throw new GuardError("domain");
  if (extra.assetTransferMethod !== undefined && extra.assetTransferMethod !== "eip3009") throw new GuardError("transfer");
  if (!Number.isInteger(r.maxTimeoutSeconds) || r.maxTimeoutSeconds <= 0 || r.maxTimeoutSeconds > MAX_TIMEOUT_CEILING_SECONDS) throw new GuardError("timeout");
  // Route consistency only: pathname + plan id. Scheme and host are not compared (the Railway proxy's internal URL scheme is unresolved).
  // resource.url is not part of what is signed, so this is a consistency check, not a cryptographic boundary.
  const raw = pr.resource?.url;
  if (typeof raw !== "string" || !raw) throw new GuardError("resource");
  let path: string;
  try {
    path = new URL(raw, origin).pathname;
  } catch {
    throw new GuardError("resource");
  }
  if (path !== "/api/run/" + exp.planId) throw new GuardError("resource");
  return r;
}

/* ---------- the guard for one payment ---------- */

export interface GuardDeps {
  provider: Pick<Eip1193Provider, "request">;
  /** The account cPilot's wallet state currently considers connected. */
  connectedAddress(): string | null;
  origin: string;
  /** Milliseconds; injectable for tests. */
  now?: () => number;
}

interface TypedDataInput {
  domain: Record<string, unknown>;
  types: Record<string, unknown>;
  primaryType: string;
  message: Record<string, unknown>;
}
export interface PaySigner {
  readonly address: `0x${string}`;
  signTypedData(message: TypedDataInput): Promise<`0x${string}`>;
}

function toBig(v: unknown, code: GuardCode): bigint {
  try {
    if (typeof v === "bigint") return v;
    if (typeof v === "number" && Number.isInteger(v)) return BigInt(v);
    if (typeof v === "string" && /^-?\d+$/.test(v)) return BigInt(v);
  } catch {
    /* fall through */
  }
  throw new GuardError(code);
}

export function createPaymentGuard(exp: Expected, address: string, deps: GuardDeps) {
  const now = deps.now ?? Date.now;
  let accepted: Requirements | null = null;

  const hook: BeforePaymentCreationHook = async (ctx) => {
    accepted = null;
    try {
      accepted = validateRequirements(ctx, exp, deps.origin);
    } catch (e) {
      return { abort: true, reason: e instanceof GuardError ? e.message : "cpilot_guard:amount" };
    }
  };

  /** Wraps the signer the x402 scheme will call. Same shape and `address`; typed data is passed through untouched. */
  function wrapSigner(inner: PaySigner): PaySigner {
    return {
      ...inner,
      async signTypedData(m: TypedDataInput): Promise<`0x${string}`> {
        const t = BigInt(Math.floor(now() / 1000)); // captured on entry, before any await (same clock x402 used to build the window)
        const req = accepted;
        if (!req) throw new GuardError("not_validated"); // the hook did not run or did not pass

        // 1. what is about to be signed
        if (m.primaryType !== "TransferWithAuthorization") throw new GuardError("type");
        const d = m.domain;
        if (d.name !== exp.token.eip712.name || d.version !== exp.token.eip712.version) throw new GuardError("domain");
        if (Number(d.chainId) !== exp.chainId) throw new GuardError("domain");
        if (lc(d.verifyingContract) !== exp.token.address.toLowerCase()) throw new GuardError("domain");
        const msg = m.message;
        if (lc(msg.to) !== exp.payTo) throw new GuardError("payTo");
        if (toBig(msg.value, "amount") !== exp.amount) throw new GuardError("amount");
        if (typeof msg.nonce !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(msg.nonce)) throw new GuardError("type");
        const from = lc(msg.from);
        if (!isAddress(msg.from) || from !== address.toLowerCase()) throw new GuardError("account");
        const validAfter = toBig(msg.validAfter, "timestamp");
        const validBefore = toBig(msg.validBefore, "timestamp");
        const window = validBefore - t;
        const maxT = BigInt(req.maxTimeoutSeconds);
        if (validAfter < 0n || validAfter > t) throw new GuardError("timestamp");
        if (window <= 0n || window > maxT || window < maxT - WINDOW_TOLERANCE_SECONDS) throw new GuardError("timestamp");

        // 2. the live wallet, not cached UI state
        let live: unknown;
        let liveChain: number | null;
        try {
          live = await deps.provider.request({ method: "eth_accounts" });
        } catch {
          throw new GuardError("account");
        }
        const first = Array.isArray(live) ? live[0] : undefined;
        if (typeof first !== "string" || first.toLowerCase() !== from) throw new GuardError("account");
        const connected = deps.connectedAddress();
        if (!connected || connected.toLowerCase() !== from) throw new GuardError("account");
        try {
          liveChain = parseChainId(await deps.provider.request({ method: "eth_chainId" }));
        } catch {
          throw new GuardError("chain");
        }
        if (liveChain !== exp.chainId) throw new GuardError("chain");

        return inner.signTypedData(m);
      },
    };
  }

  return { hook, wrapSigner, accepted: () => accepted };
}

/** Layer 1 + 2 on an x402 client: library spend control capped at the approved price, plus the requirements hook. */
export function installGuard(client: x402Client, guard: ReturnType<typeof createPaymentGuard>, exp: Expected): void {
  client.setSpendControls({
    allowedAssets: [{ network: exp.network as `${string}:${string}`, asset: exp.token.address, maxAmountPerPayment: exp.amount.toString() }],
  });
  client.onBeforePaymentCreation(guard.hook);
}
