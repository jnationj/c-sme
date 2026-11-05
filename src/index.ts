import { serve } from "@hono/node-server";
import { mkdirSync } from "node:fs";
import { privateKeyToAccount } from "viem/accounts";
import { sellerToken } from "./seller/x402.js";
import { Ledger } from "./ledger/ledger.js";
import { Orchestrator, policyFromEnv } from "./agent/orchestrator.js";
import { parseUsd } from "./chain/tokens.js";
import { directCall } from "./agent/payDirect.js";
import { createApp } from "./app.js";
import { normalizePrivateKey } from "./chain/key.js";

const testnet = (process.env.X402_NETWORK ?? "testnet") !== "mainnet";
const tokenInfo = sellerToken(testnet);
const token = tokenInfo.symbol;
const feeAtomic = parseUsd(process.env.REPORT_FEE_USD ?? "0.02");

mkdirSync("data", { recursive: true });
const ledger = new Ledger(process.env.LEDGER_PATH ?? "data/ledger.db");
const policyCfg = policyFromEnv(token);
const agent = new Orchestrator({
  ledger,
  policy: policyCfg,
  token,
  account: process.env.BUY_ACCOUNT ?? (testnet ? "testbuyer" : "agent"),
  sandbox: testnet,
  feeAtomic,
});

// PAY_BACKEND=direct pays providers with the x402 library (no OS keychain needed, works on a cloud host).
// Default is the buy CLI. The signing key comes from PAY_PRIVATE_KEY, else AGENT_PRIVATE_KEY (never logged).
const payBackend = process.env.PAY_BACKEND ?? "buy";
const payKeyVar = process.env.PAY_PRIVATE_KEY ? "PAY_PRIVATE_KEY" : "AGENT_PRIVATE_KEY";
const payKey = normalizePrivateKey(process.env[payKeyVar], payKeyVar); // tolerates a missing 0x prefix; fails clearly on anything else
if (payBackend === "direct" && !payKey) throw new Error("PAY_BACKEND=direct needs PAY_PRIVATE_KEY or AGENT_PRIVATE_KEY");
agent.setPayer(
  payBackend === "direct"
    ? (a) => directCall({ url: a.url, body: a.body, privateKey: payKey!, sandbox: testnet, tokenAddress: tokenInfo.address, maxAtomic: a.maxAtomic })
    : undefined,
);

const app = createApp({
  testnet,
  chainId: testnet ? 11142220 : 42220,
  token,
  feeAtomic,
  adminToken: process.env.ADMIN_TOKEN,
  ledger,
  agent,
  policyCfg,
  env: process.env,
});

// Startup report for the host logs: names and yes/no only, never values.
const present = (v: string | undefined) => (v && v.trim() ? "set" : "MISSING");
console.log("config check:", {
  network: testnet ? "testnet" : "MAINNET",
  payBackend,
  SELLER_PAY_TO: present(process.env.SELLER_PAY_TO),
  X402_API_KEY: present(process.env.X402_API_KEY),
  payerKey: present(process.env.PAY_PRIVATE_KEY ?? process.env.AGENT_PRIVATE_KEY),
  DEEPSEEK_API_KEY: present(process.env.DEEPSEEK_API_KEY),
  ledger: process.env.LEDGER_PATH ?? "data/ledger.db",
});
// The payer's PUBLIC address is safe to log and shows which key is actually in use.
const payerAddress = payKey ? privateKeyToAccount(payKey).address : undefined;
console.log("payer address:", payerAddress ?? "(buy CLI account)", "| seller pay-to:", process.env.SELLER_PAY_TO ?? "(unset)");
if (!testnet && payerAddress && process.env.SELLER_PAY_TO && payerAddress.toLowerCase() !== process.env.SELLER_PAY_TO.toLowerCase()) {
  console.warn("WARNING: on mainnet the payer key does not control SELLER_PAY_TO. Check AGENT_PRIVATE_KEY and remove PAY_PRIVATE_KEY.");
}
if (process.env.PAY_PRIVATE_KEY && !testnet) console.warn("WARNING: PAY_PRIVATE_KEY is set on mainnet and takes priority over AGENT_PRIVATE_KEY. Remove it unless intended.");
if (!process.env.X402_API_KEY) console.warn("X402_API_KEY is missing: customer payments cannot settle until it is set.");
if (!process.env.DEEPSEEK_API_KEY && !process.env.ANTHROPIC_API_KEY) console.warn("No LLM key set: reports are computed directly from the data, without an AI writer.");

// Hosts route traffic from outside the container, so bind all interfaces explicitly and honour the host's PORT.
const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, (i) => console.log(`c-sme listening on 0.0.0.0:${i.port} (${testnet ? "testnet" : "MAINNET"})`));
