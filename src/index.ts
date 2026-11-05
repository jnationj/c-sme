import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createPaywall, sellerToken } from "./seller/x402.js";
import { Ledger } from "./ledger/ledger.js";
import { Orchestrator, policyFromEnv } from "./agent/orchestrator.js";
import { formatUsd, parseUsd } from "./chain/tokens.js";
import { PAGE } from "./web/page.js";
import { RunGate, decodeSettlement, hasDeliverable, isTxHash, parsePositiveInt } from "./agent/delivery.js";
import { renderReceipt } from "./web/receipt.js";
import { directCall } from "./agent/payDirect.js";

const testnet = (process.env.X402_NETWORK ?? "testnet") !== "mainnet";
const tokenInfo = sellerToken(testnet);
const token = tokenInfo.symbol;
const chainId = testnet ? 11142220 : 42220;
const feeAtomic = parseUsd(process.env.REPORT_FEE_USD ?? "0.02");
const adminToken = process.env.ADMIN_TOKEN;

mkdirSync("data", { recursive: true });
const ledger = new Ledger(process.env.LEDGER_PATH ?? "data/ledger.db");
const agent = new Orchestrator({
  ledger,
  policy: policyFromEnv(token),
  token,
  account: process.env.BUY_ACCOUNT ?? (testnet ? "testbuyer" : "agent"),
  sandbox: testnet,
  feeAtomic,
});

// PAY_BACKEND=direct pays providers with the x402 library (no OS keychain needed, works on a cloud host).
// Default is the buy CLI. The signing key comes from PAY_PRIVATE_KEY, else AGENT_PRIVATE_KEY (never logged).
const payBackend = process.env.PAY_BACKEND ?? "buy";
const payKey = (process.env.PAY_PRIVATE_KEY ?? process.env.AGENT_PRIVATE_KEY) as `0x${string}` | undefined;
if (payBackend === "direct" && !payKey) throw new Error("PAY_BACKEND=direct needs PAY_PRIVATE_KEY or AGENT_PRIVATE_KEY");
agent.setPayer(
  payBackend === "direct"
    ? (a) => directCall({ url: a.url, body: a.body, privateKey: payKey!, sandbox: testnet, tokenAddress: tokenInfo.address, maxAtomic: a.maxAtomic })
    : undefined,
);

const app = new Hono();
app.get("/", (c) => c.html(PAGE));
app.get("/client.js", (c) => {
  if (!existsSync("web/client.js")) return c.text("client bundle missing: run pnpm build:web", 404);
  return c.body(readFileSync("web/client.js"), 200, { "content-type": "text/javascript; charset=utf-8" });
});
app.get("/health", (c) => c.json({ ok: true, service: "c-sme", network: testnet ? "testnet" : "mainnet" }));
app.get("/api/config", (c) =>
  c.json({
    network: testnet ? "Celo Sepolia (test money)" : "Celo mainnet (real money)",
    testnet,
    chainId,
    token,
    feeUsd: formatUsd(feeAtomic),
    // On testnet anyone may run the agent with its own test funds. On mainnet that needs an admin token.
    freeRunAllowed: testnet,
  }),
);

const describePlan = (p: { id: string; totalAtomic: bigint; customerAtomic: bigint; steps: Array<{ provider: string; why: string; quoteAtomic: bigint }> }) => ({
  id: p.id,
  dataUsd: formatUsd(p.totalAtomic),
  feeUsd: formatUsd(feeAtomic),
  customerUsd: formatUsd(p.customerAtomic),
  steps: p.steps.map((s) => ({ provider: s.provider, why: s.why, usd: formatUsd(s.quoteAtomic) })),
});

app.post("/api/plan", async (c) => {
  const { question } = await c.req.json<{ question?: string }>();
  if (!question || question.length > 500) return c.json({ error: "question required (max 500 chars)" }, 400);
  try {
    return c.json(describePlan(await agent.propose(question)));
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }
});

// Operator-only: runs the plan using the agent's own funds. Open on testnet, locked on mainnet.
app.post("/api/approve", async (c) => {
  if (!testnet && (!adminToken || c.req.header("x-admin-token") !== adminToken)) {
    return c.json({ error: "forbidden: on mainnet the customer must pay via /api/run" }, 403);
  }
  const { planId } = await c.req.json<{ planId?: string }>();
  try {
    const result = await agent.approve(planId ?? "");
    persist(result, null, false);
    return c.json(result);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});

type RunResult = Awaited<ReturnType<Orchestrator["approve"]>>;
/** Save a finished report so it can be shown as a shareable receipt later. */
function persist(result: RunResult, payer: string | null, paid: boolean): void {
  const plan = agent.getPlan(result.planId);
  if (!plan || !hasDeliverable(result.payments)) return;
  ledger.saveReport({
    planId: result.planId,
    question: plan.question,
    report: result.report.text,
    writtenBy: result.report.by,
    payments: result.payments,
    dataAtomic: ledger.spentForTask(result.planId),
    customerAtomic: paid ? plan.customerAtomic : null,
    payer,
  });
}

const explorerTx = testnet ? "https://celo-sepolia.blockscout.com/tx/" : "https://celoscan.io/tx/";
function receiptFor(planId: string) {
  const r = ledger.getReport(planId);
  if (!r) return undefined;
  const inRow = ledger.getPayment("in:" + planId);
  return {
    planId: r.planId,
    question: r.question,
    report: r.report,
    writtenBy: r.writtenBy,
    network: testnet ? "Celo Sepolia (test money)" : "Celo mainnet (real money)",
    explorerTx,
    createdAt: r.createdAt,
    dataUsd: formatUsd(r.dataAtomic),
    customerUsd: r.customerAtomic === null ? null : formatUsd(r.customerAtomic),
    payer: r.payer,
    customerTx: inRow?.txHash ?? null,
    purchases: (r.payments as Array<{ title: string; usd: string; status: string; tx: string | null }>).map((p) => ({ title: p.title, usd: p.usd, status: p.status, tx: p.tx })),
  };
}
app.get("/r/:planId", (c) => {
  const v = receiptFor(c.req.param("planId"));
  return v ? c.html(renderReceipt(v)) : c.text("receipt not found", 404);
});
app.get("/api/receipt/:planId", (c) => {
  const v = receiptFor(c.req.param("planId"));
  return v ? c.json(v) : c.json({ error: "not found" }, 404);
});
// Anonymous usage stats for the operator: counts and totals per (shortened) customer wallet, no questions.
app.get("/api/customers", (c) =>
  c.json(
    ledger.customerStats().map((x) => ({
      customer: x.payer.slice(0, 6) + "…" + x.payer.slice(-4),
      runs: x.runs,
      paidUsd: formatUsd(x.paidAtomic),
      repeat: x.runs > 1,
      firstAt: x.firstAt,
      lastAt: x.lastAt,
    })),
  ),
);

app.get("/api/ledger", (c) => {
  const rows = ledger.db.prepare("SELECT * FROM payments ORDER BY created_at DESC LIMIT 50").all() as any[];
  return c.json({
    network: testnet ? "Celo Sepolia (test money)" : "Celo mainnet (real money)",
    payments: rows.map((r) => ({
      direction: r.direction,
      provider: r.provider,
      usd: formatUsd(BigInt(r.amount)),
      status: r.status,
      txHash: r.tx_hash,
      createdAt: r.created_at,
    })),
  });
});

/** Best-effort: the payer address is inside the signed payment header the customer sent. */
function payerOf(header: string | undefined): string | null {
  if (!header) return null;
  try {
    const j = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
    return j?.payload?.authorization?.from ?? null;
  } catch {
    return null;
  }
}

const payTo = process.env.SELLER_PAY_TO;
if (payTo) {
  // Customer pays (data cost + our fee) in USDC on Sepolia / USA₮ on mainnet, then the agent runs.
  // x402 settles only after the handler succeeds, so a failed run is not charged.
  // Outermost layer for /api/run/*: guards the plan, stops serving if customer settlements keep failing,
  // and after the x402 middleware has settled (or failed to) reconciles the ledger from the settlement result.
  const gate = new RunGate(parsePositiveInt("MAX_UNSETTLED_RUNS", process.env.MAX_UNSETTLED_RUNS, 3));
  app.use("/api/run/*", async (c, next) => {
    const id = c.req.path.split("/").pop() ?? "";
    const p = agent.getPlan(id);
    if (!p || p.status !== "proposed" || !p.steps.length) return c.json({ error: "unknown or already used plan" }, 404);
    // Bounded exposure: each run spends provider money before the customer's payment settles, so stop
    // accepting new runs once too many earlier customer payments failed or are still unconfirmed.
    // The slot is reserved here, before any provider spend, and released only after reconciliation.
    if (!gate.tryEnter(ledger.countIncoming("failed") + ledger.countIncoming("submitted", 5 * 60_000))) {
      return c.json({ error: "temporarily unavailable, please try again later" }, 503);
    }
    try {
      await next();
      const key = `in:${id}`;
      if (ledger.keyUsed(key)) {
        const s = decodeSettlement(c.res.headers.get("payment-response") ?? c.res.headers.get("x-payment-response"));
        if (s?.success && isTxHash(s.transaction)) {
          ledger.setStatus(key, "settled", s.transaction);
        } else {
          // Includes "success but no verifiable transaction hash": not trusted as settled.
          ledger.setStatus(key, "failed");
          ledger.record("customer_settlement_failed", { status: c.res.status, plan: id, hadSuccessFlag: s?.success === true }, id);
        }
      }
    } finally {
      gate.leave();
    }
  });
  app.use(
    createPaywall(
      { testnet, payTo, apiKey: process.env.X402_API_KEY, builderCode: process.env.ATTRIBUTION_TAG ?? "celo_d0da34839ac6" },
      "POST /api/run/*",
      (path) => agent.getPlan(path.split("/").pop() ?? "")?.customerAtomic,
      "CorridorPilot research report",
    ),
  );
  app.post("/api/run/:planId", async (c) => {
    const planId = c.req.param("planId");
    const plan = agent.getPlan(planId);
    const payer = payerOf(c.req.header("payment-signature") ?? c.req.header("x-payment"));
    try {
      const result = await agent.approve(planId);
      // No data bought means no report: answer non-2xx so x402 does not settle (charge) the customer.
      if (!hasDeliverable(result.payments)) {
        return c.json({ error: "no data could be bought, so there is no report. You were not charged. Please ask again.", payments: result.payments }, 502);
      }
      if (plan) {
        const key = `in:${planId}`;
        ledger.createPayment({ idempotencyKey: key, taskId: planId, direction: "in", provider: "customer", token, amount: plan.customerAtomic, counterparty: payer });
        ledger.setStatus(key, "submitted"); // becomes settled once the facilitator settlement is confirmed
        ledger.record("customer_payment_expected", { payer, amount: plan.customerAtomic.toString() }, planId);
      }
      persist(result, payer, true);
      return c.json(result);
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
  });
} else {
  console.warn("SELLER_PAY_TO not set: paid routes disabled");
}

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, (i) => console.log(`c-sme listening on http://localhost:${i.port} (${testnet ? "testnet" : "MAINNET"})`));
