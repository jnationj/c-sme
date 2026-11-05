import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { mkdirSync } from "node:fs";
import { createPaywall, sellerToken } from "./seller/x402.js";
import { Ledger } from "./ledger/ledger.js";
import { Orchestrator, policyFromEnv } from "./agent/orchestrator.js";
import { formatUsd } from "./chain/tokens.js";
import { PAGE } from "./web/page.js";

const testnet = (process.env.X402_NETWORK ?? "testnet") !== "mainnet";
const token = sellerToken(testnet).symbol;
mkdirSync("data", { recursive: true });
const ledger = new Ledger(process.env.LEDGER_PATH ?? "data/ledger.db");
const agent = new Orchestrator({
  ledger,
  policy: policyFromEnv(token),
  token,
  account: process.env.BUY_ACCOUNT ?? (testnet ? "testbuyer" : "agent"),
  sandbox: testnet,
});

const app = new Hono();
app.get("/", (c) => c.html(PAGE));
app.get("/health", (c) => c.json({ ok: true, service: "c-sme", network: testnet ? "testnet" : "mainnet" }));

app.post("/api/plan", async (c) => {
  const { question } = await c.req.json<{ question?: string }>();
  if (!question || question.length > 500) return c.json({ error: "question required (max 500 chars)" }, 400);
  try {
    const p = await agent.propose(question);
    return c.json({
      id: p.id,
      totalUsd: formatUsd(p.totalAtomic),
      steps: p.steps.map((s) => ({ provider: s.provider, why: s.why, usd: formatUsd(s.quoteAtomic) })),
    });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }
});

app.post("/api/approve", async (c) => {
  const { planId } = await c.req.json<{ planId?: string }>();
  try {
    return c.json(await agent.approve(planId ?? ""));
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});

app.get("/api/ledger", (c) => {
  const rows = ledger.db.prepare("SELECT * FROM payments ORDER BY created_at DESC LIMIT 50").all() as any[];
  return c.json({
    network: testnet ? "Celo Sepolia (test money)" : "Celo mainnet (real money)",
    payments: rows.map((r) => ({
      provider: r.provider,
      usd: formatUsd(BigInt(r.amount)),
      status: r.status,
      txHash: r.tx_hash,
      createdAt: r.created_at,
    })),
  });
});

const payTo = process.env.SELLER_PAY_TO;
if (payTo) {
  const route = "POST /api/report";
  app.use(createPaywall({ testnet, payTo, apiKey: process.env.X402_API_KEY, priceUsd: process.env.REPORT_PRICE_USD ?? "0.02" }, route));
  app.post("/api/report", (c) => c.json({ status: "paid", token }));
} else {
  console.warn("SELLER_PAY_TO not set: paid routes disabled");
}

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, (i) => console.log(`c-sme listening on http://localhost:${i.port}`));
