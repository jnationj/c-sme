import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createPaywall, sellerToken } from "./seller/x402.js";
import { Ledger } from "./ledger/ledger.js";
import { Orchestrator, policyFromEnv } from "./agent/orchestrator.js";
import { formatUsd, parseUsd } from "./chain/tokens.js";
import { RunGate, decodeSettlement, hasDeliverable, isTxHash, parsePositiveInt } from "./agent/delivery.js";
import { RateLimiter, clientIp } from "./agent/ratelimit.js";
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
const payKey = (process.env.PAY_PRIVATE_KEY ?? process.env.AGENT_PRIVATE_KEY) as `0x${string}` | undefined;
if (payBackend === "direct" && !payKey) throw new Error("PAY_BACKEND=direct needs PAY_PRIVATE_KEY or AGENT_PRIVATE_KEY");
agent.setPayer(
  payBackend === "direct"
    ? (a) => directCall({ url: a.url, body: a.body, privateKey: payKey!, sandbox: testnet, tokenAddress: tokenInfo.address, maxAtomic: a.maxAtomic })
    : undefined,
);

const app = new Hono();

// Per-visitor limits so a public URL cannot drain the LLM key or the test-fund budget. Tunable by env.
const planLimiter = new RateLimiter(parsePositiveInt("RATE_PLANS_PER_HOUR", process.env.RATE_PLANS_PER_HOUR, 30), 3_600_000);
const runLimiter = new RateLimiter(parsePositiveInt("RATE_RUNS_PER_HOUR", process.env.RATE_RUNS_PER_HOUR, 10), 3_600_000);
const limited = (lim: RateLimiter) => async (c: import("hono").Context, next: () => Promise<void>) => {
  if (c.req.method !== "POST") return next();
  if (!lim.allow(clientIp((n) => c.req.header(n)))) {
    return c.json({ error: "Too many requests from your network. Please wait a while and try again." }, 429, { "retry-after": "600" });
  }
  return next();
};
app.use("/api/plan", limited(planLimiter));
app.use("/api/approve", limited(runLimiter));
app.use("/api/run/*", limited(runLimiter));
const webDir = fileURLToPath(new URL("./web/", import.meta.url));
const asset = (file: string, type: string) => (c: import("hono").Context) => {
  const p = webDir + file;
  if (!existsSync(p)) return c.text("missing " + file, 404);
  return c.body(readFileSync(p), 200, { "content-type": type, "cache-control": "no-cache" });
};
// The page carries absolute URLs for social previews (og:image etc.), so fill in our public address at request time.
function publicOrigin(c: import("hono").Context): string {
  const fixed = process.env.PUBLIC_URL?.trim().replace(/\/+$/, "");
  if (fixed) return fixed;
  const host = c.req.header("x-forwarded-host") ?? c.req.header("host") ?? "localhost";
  const proto = c.req.header("x-forwarded-proto")?.split(",")[0]?.trim() ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
app.get("/", (c) => {
  const p = webDir + "index.html";
  if (!existsSync(p)) return c.text("missing index.html", 404);
  const html = readFileSync(p, "utf8").split("__PUBLIC_URL__").join(publicOrigin(c));
  return c.html(html, 200, { "cache-control": "no-cache" });
});
app.get("/og.png", (c) => {
  const p = webDir + "og.png";
  if (!existsSync(p)) return c.text("missing og.png", 404);
  return c.body(readFileSync(p), 200, { "content-type": "image/png", "cache-control": "public, max-age=3600" });
});
app.get("/app.js", asset("app.js", "text/javascript; charset=utf-8"));
app.get("/styles.css", asset("styles.css", "text/css; charset=utf-8"));
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
    agentWallet: process.env.SELLER_PAY_TO ?? null,
    builderCode: process.env.ATTRIBUTION_TAG ?? "celo_d0da34839ac6",
    agentId: process.env.AGENT_ID ?? null, // set after ERC-8004 registration
    repoUrl: process.env.REPO_URL ?? "https://github.com/jnationj/c-sme",
    explorer: testnet ? "https://celo-sepolia.blockscout.com" : "https://celoscan.io",
    limits: { perCallUsd: formatUsd(policyCfg.perCallCap), perTaskUsd: formatUsd(policyCfg.perTaskCap), dailyUsd: formatUsd(policyCfg.dailyCap) },
  }),
);

// Live progress of a run (the plan id is an unguessable UUID).
app.get("/api/progress/:planId", (c) => {
  const p = agent.getPlan(c.req.param("planId"));
  if (!p) return c.json({ error: "unknown plan" }, 404);
  return c.json({
    stage: p.stage,
    steps: p.steps.map((st, i) => ({ why: st.why, provider: st.provider, usd: formatUsd(st.quoteAtomic), state: p.progress[i]?.state ?? "pending", tx: p.progress[i]?.tx ?? null })),
  });
});

// Public proof: real counts from the ledger, no questions or full wallet addresses.
app.get("/api/proof", (c) => {
  const customers = ledger.customerStats();
  const paidUsd = customers.reduce((a, x) => a + x.paidAtomic, 0n);
  const n = (sql: string) => (ledger.db.prepare(sql).get() as { n: number }).n;
  const providerPurchases = n("SELECT COUNT(*) AS n FROM payments WHERE direction = 'out' AND status = 'settled'");
  const dataSpent = (ledger.db.prepare("SELECT amount FROM payments WHERE direction = 'out' AND status = 'settled'").all() as { amount: string }[]).reduce((a, r) => a + BigInt(r.amount), 0n);
  const recent = (ledger.db.prepare("SELECT direction, provider, amount, status, tx_hash, created_at FROM payments WHERE status = 'settled' AND tx_hash IS NOT NULL ORDER BY created_at DESC LIMIT 8").all() as Array<Record<string, unknown>>).map((r) => ({
    direction: r.direction,
    provider: r.provider,
    usd: formatUsd(BigInt(r.amount as string)),
    tx: r.tx_hash,
    at: r.created_at,
  }));
  return c.json({
    paidReports: n("SELECT COUNT(*) AS n FROM reports WHERE payer IS NOT NULL"),
    customers: customers.length,
    repeatCustomers: customers.filter((x) => x.runs > 1).length,
    customerPaidUsd: formatUsd(paidUsd),
    providerPurchases,
    onChainPayments: providerPurchases + n("SELECT COUNT(*) AS n FROM payments WHERE direction = 'in' AND status = 'settled'"),
    dataSpentUsd: formatUsd(dataSpent),
    recent,
  });
});

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
    return c.json({ ...result, receipt: hasDeliverable(result.payments) });
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
      return c.json({ ...result, receipt: true });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
  });
} else {
  console.warn("SELLER_PAY_TO not set: paid routes disabled");
}

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
if (!process.env.X402_API_KEY) console.warn("X402_API_KEY is missing: customer payments cannot settle until it is set.");
if (!process.env.DEEPSEEK_API_KEY && !process.env.ANTHROPIC_API_KEY) console.warn("No LLM key set: reports will be a plain data list.");

// Hosts route traffic from outside the container, so bind all interfaces explicitly and honour the host's PORT.
const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, (i) => console.log(`c-sme listening on 0.0.0.0:${i.port} (${testnet ? "testnet" : "MAINNET"})`));
