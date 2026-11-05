/** Pure helpers for the customer-pays route, kept separate so they can be unit-tested without a server. */

export interface PaymentLogEntry {
  status: string;
}

/**
 * A run is deliverable only if at least one data purchase settled. Otherwise the route must answer with a
 * non-2xx status so the x402 middleware does NOT settle the customer's payment (it settles only on success).
 */
export function hasDeliverable(payments: PaymentLogEntry[]): boolean {
  return payments.some((p) => p.status === "settled");
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
