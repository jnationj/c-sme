// Sepolia end-to-end test: the throwaway buyer pays our own /api/report. Run the server first (pnpm dev).
//   pnpm pay:test
import { x402Client } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { wrapFetchWithPayment, decodePaymentResponseHeader } from "@x402/fetch";
import { privateKeyToAccount } from "viem/accounts";

const key = process.env.BUYER_PRIVATE_KEY as `0x${string}` | undefined;
if (!key) throw new Error("BUYER_PRIVATE_KEY missing (run pnpm wallet:buyer)");
const url = process.env.REPORT_URL ?? "http://localhost:8787/api/report";

const client = new x402Client();
registerExactEvmScheme(client, { signer: privateKeyToAccount(key) });
const pay = wrapFetchWithPayment(fetch, client);

const res = await pay(url, { method: "POST" });
console.log("status:", res.status);
console.log("body:", await res.text());
const h = res.headers.get("payment-response") ?? res.headers.get("x-payment-response");
console.log("settlement:", h ? decodePaymentResponseHeader(h) : "(no payment-response header)");
