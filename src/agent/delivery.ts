/** Pure helpers for the customer-pays route, kept separate so they can be unit-tested without a server. */

export interface PaymentLogEntry {
  status: string;
  usableData?: boolean;
}

/**
 * A run is deliverable only if at least one data purchase settled. Otherwise the route must answer with a
 * non-2xx status so the x402 middleware does NOT settle the customer's payment (it settles only on success).
 */
export function hasDeliverable(payments: PaymentLogEntry[]): boolean {
  return payments.some((p) => p.status === "settled" && p.usableData !== false);
}

export interface Settlement {
  success: boolean;
  transaction?: string;
  payer?: string;
}

/** Decode the PAYMENT-RESPONSE header the x402 middleware adds after settling. Returns undefined if absent or malformed. */
export function decodeSettlement(header: string | null | undefined): Settlement | undefined {
  if (!header) return undefined;
  try {
    const j = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
    if (typeof j?.success !== "boolean") return undefined;
    return { success: j.success, transaction: j.transaction, payer: j.payer };
  } catch {
    return undefined;
  }
}

/** The payer address inside an x402 payment header (base64 JSON). Best effort: null if it cannot be read. */
export function payerFromHeader(header: string | undefined): string | null {
  if (!header) return null;
  try {
    const j = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
    const from = j?.payload?.authorization?.from;
    return typeof from === "string" ? from : null;
  } catch {
    return null;
  }
}

/**
 * The facilitator refuses a payment whose payer and recipient are the same address, but only AFTER our agent has
 * already bought data. Detect it from the header so we can refuse before spending anything.
 */
export function isSelfPayment(header: string | undefined, payTo: string | undefined): boolean {
  const payer = payerFromHeader(header);
  return !!payer && !!payTo && payer.toLowerCase() === payTo.toLowerCase();
}

export const isTxHash = (h: unknown): h is string => typeof h === "string" && /^0x[0-9a-fA-F]{64}$/.test(h);

/** Parse a positive-integer env value. A typo must stop startup, not silently disable a safety limit. */
export function parsePositiveInt(name: string, raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${name} must be a positive integer, got "${raw}"`);
  return n;
}

/**
 * Bounds how many customer payments can be unsettled at once, INCLUDING runs still in flight.
 * Node runs this synchronously, so tryEnter() cannot interleave: concurrent requests cannot all pass the check.
 */
export class RunGate {
  private inFlightCount = 0;
  constructor(readonly max: number) {}
  /** unsettled = customer payments already known to be failed or overdue-unconfirmed. */
  tryEnter(unsettled: number): boolean {
    if (unsettled + this.inFlightCount >= this.max) return false;
    this.inFlightCount += 1;
    return true;
  }
  leave(): void {
    this.inFlightCount = Math.max(0, this.inFlightCount - 1);
  }
  get inFlight(): number {
    return this.inFlightCount;
  }
}
