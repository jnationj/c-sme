import { x402Client } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import { privateKeyToAccount } from "viem/accounts";
import { BuyError, type BuyResult } from "./buyClient.js";

export interface DirectOpts {
  url: string;
  body: unknown;
  privateKey: `0x${string}`;
  sandbox: boolean;
  tokenAddress: string;
  maxAtomic: bigint;
  timeoutMs?: number;
}

const NETWORKS = {
  mainnet: ["celo", "eip155:42220"],
  sandbox: ["celo-sepolia", "eip155:11142220"],
};

/**
 * Pays a catalog call with the x402 client library instead of the `buy` CLI. Needed on hosts without an OS
 * keychain (buy refuses file-based keys on mainnet). Same safety rules as the CLI path: we pick the exact
 * token and network ourselves, and refuse any offer above the approved amount.
 */
/**
 * Could money have moved? Only if a signed payment was actually sent AND we have no proof it was rejected.
 * A 402 after sending means the gateway rejected the payment (for example an unfunded wallet): nothing settled.
 * Being too cautious here is costly: one "uncertain" payment freezes all spending.
 */
export function directFailureMayHavePaid(f: { paymentSent: boolean; status?: number; paymentSettledFlag?: boolean }): boolean {
  if (!f.paymentSent) return false;
  if (f.paymentSettledFlag === false) return false;
  if (f.status === 402) return false;
  return true;
}

export async function directCall(o: DirectOpts): Promise<BuyResult> {
  const nets = o.sandbox ? NETWORKS.sandbox : NETWORKS.mainnet;
  let chosen: bigint | null = null;
  const client = new x402Client((_version, accepts) => {
    const hit = accepts.find((r: any) => nets.includes(r.network) && String(r.asset).toLowerCase() === o.tokenAddress.toLowerCase());
    if (!hit) throw new BuyError("no payable offer in the requested token on this network (nothing paid)", false);
    const amount = BigInt((hit as any).amount ?? (hit as any).maxAmountRequired);
    if (amount > o.maxAtomic) throw new BuyError(`offer ${amount} exceeds approved ${o.maxAtomic} (nothing paid)`, false);
    chosen = amount;
    return hit;
  });
  registerExactEvmScheme(client, { signer: privateKeyToAccount(o.privateKey) });
  // Track whether a request carrying a signed payment was ever sent (the only way money can move).
  let paymentSent = false;
  const tracked: typeof fetch = async (input, init) => {
    const fromInit = new Headers(init?.headers);
    const fromReq = input instanceof Request ? input.headers : undefined;
    if (fromInit.has("payment-signature") || fromInit.has("x-payment") || fromReq?.has("payment-signature") || fromReq?.has("x-payment")) paymentSent = true;
    return fetch(input, init);
  };
  const pay = wrapFetchWithPayment(tracked, client);
  let res: Response;
  try {
    res = await pay(o.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(o.body),
      signal: AbortSignal.timeout(o.timeoutMs ?? 120_000),
    });
  } catch (e) {
    if (e instanceof BuyError) throw e;
    // Network or abort after a payment may have been signed: treat as uncertain.
    throw new BuyError(`direct_pay_failed: ${(e as Error).message}`.slice(0, 300), directFailureMayHavePaid({ paymentSent }));
  }
  const text = await res.text();
  let j: any;
  try {
    j = JSON.parse(text);
  } catch {
    throw new BuyError("unparseable response" + (directFailureMayHavePaid({ paymentSent, status: res.status }) ? " (payment may have settled)" : " (nothing was charged)"), directFailureMayHavePaid({ paymentSent, status: res.status }));
  }
  if (j.error || !res.ok) {
    const mayHavePaid = directFailureMayHavePaid({ paymentSent, status: res.status, paymentSettledFlag: j.paymentSettled === false ? false : undefined });
    throw new BuyError(`${j.error ?? "http_" + res.status}${j.providerStatus ? ` (provider ${j.providerStatus})` : ""}: not charged=${!mayHavePaid}`, mayHavePaid);
  }
  if (!j.transaction) throw new BuyError("response had no transaction hash; payment state unknown", true);
  return { transaction: j.transaction, paidAtomic: j.payment?.atomic ?? (chosen ? String(chosen) : null), token: j.payment?.token ?? null, output: j.output ?? j };
}
