// Sepolia end-to-end test: the throwaway buyer plays the customer. It asks for a plan, then pays for it.
// Start the server first (pnpm dev), then:  pnpm pay:test
import { x402Client } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { wrapFetchWithPayment, decodePaymentResponseHeader } from "@x402/fetch";
import { privateKeyToAccount } from "viem/accounts";

const key = process.env.BUYER_PRIVATE_KEY as `0x${string}` | undefined;
if (!key) throw new Error("BUYER_PRIVATE_KEY missing (run pnpm wallet:buyer)");
const base = process.env.BASE_URL ?? "http://localhost:8787";
const question = process.env.QUESTION ?? "Which hashtags are trending on TikTok for AI tools?";

const client = new x402Client();
registerExactEvmScheme(client, { signer: privateKeyToAccount(key) });
const pay = wrapFetchWithPayment(fetch, client);

const planRes = await fetch(base + "/api/plan", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ question }),
});
const plan = (await planRes.json()) as { id: string; customerUsd: string; dataUsd: string; feeUsd: string };
console.log("plan", plan.id, "| data $" + plan.dataUsd, "+ fee $" + plan.feeUsd, "= customer pays $" + plan.customerUsd);

const res = await pay(base + "/api/run/" + plan.id, { method: "POST" });
console.log("status:", res.status);
console.log("body:", (await res.text()).slice(0, 1200));
const h = res.headers.get("payment-response") ?? res.headers.get("x-payment-response");
console.log("settlement:", h ? decodePaymentResponseHeader(h) : "(no payment-response header)");
