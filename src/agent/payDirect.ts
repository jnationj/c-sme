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
  const pay = wrapFetchWithPayment(fetch, client);
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
    throw new BuyError(`direct_pay_failed: ${(e as Error).message}`.slice(0, 300), chosen !== null);
  }
  const text = await res.text();
  let j: any;
  try {
    j = JSON.parse(text);
  } catch {
    throw new BuyError("unparseable response (payment may have settled)", chosen !== null);
  }
  if (j.error || !res.ok) {
    const notCharged = j.paymentSettled === false || chosen === null;
    throw new BuyError(`${j.error ?? "http_" + res.status}${j.providerStatus ? ` (provider ${j.providerStatus})` : ""}: not charged=${notCharged}`, !notCharged);
  }
  if (!j.transaction) throw new BuyError("response had no transaction hash; payment state unknown", true);
  return { transaction: j.transaction, paidAtomic: j.payment?.atomic ?? (chosen ? String(chosen) : null), token: j.payment?.token ?? null, output: j.output ?? j };
}
