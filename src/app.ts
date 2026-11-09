import { Hono, type Context } from "hono";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createPaywall } from "./seller/x402.js";
import { startOfUtcDay, type Ledger } from "./ledger/ledger.js";
import type { Orchestrator } from "./agent/orchestrator.js";
import { getCatalog, validateCapabilityInput, type Capability, type CapabilityPrice } from "./agent/catalog.js";
import type { PlanStep } from "./agent/planner.js";
import type { PolicyConfig } from "./policy/engine.js";
import { formatUsd } from "./chain/tokens.js";
import { RunGate, decodeSettlement, hasDeliverable, isSelfPayment, isTxHash, parsePositiveInt, payerFromHeader } from "./agent/delivery.js";
import { RateLimiter, clientIp } from "./agent/ratelimit.js";
import { renderReceipt, type ReceiptView, type WithheldReceiptView } from "./web/receipt.js";

export interface AppDeps {
  testnet: boolean;
  chainId: number;
  token: string;
  feeAtomic: bigint;
  adminToken?: string;
  ledger: Ledger;
  agent: Orchestrator;
  policyCfg: PolicyConfig;
  /** Environment values the routes read (PUBLIC_URL, SELLER_PAY_TO, X402_API_KEY, ATTRIBUTION_TAG, AGENT_ID, REPO_URL, RATE_*, MAX_UNSETTLED_RUNS). */
  env: Record<string, string | undefined>;
  /** Directory holding index.html, app.js, styles.css, og.png. Defaults to src/web next to this file. */
  webDir?: string;
  /** Path of the bundled browser wallet client. Defaults to web/client.js in the working directory. */
  clientBundle?: string;
  /** Path of the lazily loaded Privy bundle. Defaults to web/auth.js in the working directory. */
  authBundle?: string;
  /** Test hook for the live Buy catalogue. Production always reads https://gateway.usebuy.ai. */
  getCatalog?: typeof getCatalog;
}

/** Builds the whole HTTP app. Kept free of side effects (no listening, no env reads) so tests can drive it with fakes. */
export function createApp(d: AppDeps): Hono {
  const { testnet, chainId, token, feeAtomic, adminToken, ledger, agent, policyCfg, env } = d;
  const app = new Hono();

  // Per-visitor limits so a public URL cannot drain the LLM key or the test-fund budget. Tunable by env.
  const planLimiter = new RateLimiter(parsePositiveInt("RATE_PLANS_PER_HOUR", env.RATE_PLANS_PER_HOUR, 30), 3_600_000);
  const runLimiter = new RateLimiter(parsePositiveInt("RATE_RUNS_PER_HOUR", env.RATE_RUNS_PER_HOUR, 10), 3_600_000);
  const limited = (lim: RateLimiter) => async (c: Context, next: () => Promise<void>) => {
    if (c.req.method !== "POST") return next();
    if (!lim.allow(clientIp((n) => c.req.header(n)))) {
      return c.json({ error: "Too many requests from your network. Please wait a while and try again." }, 429, { "retry-after": "600" });
    }
    return next();
  };
  app.use("/api/plan", limited(planLimiter));
  app.use("/api/selection", limited(planLimiter));
  app.use("/api/approve", limited(runLimiter));
  app.use("/api/run/*", limited(runLimiter));

  const webDir = d.webDir ?? fileURLToPath(new URL("./web/", import.meta.url));
  const asset = (file: string, type: string) => (c: Context) => {
    const p = webDir + file;
    if (!existsSync(p)) return c.text("missing " + file, 404);
    return c.body(readFileSync(p), 200, { "content-type": type, "cache-control": "no-cache" });
  };
  // The page carries absolute URLs for social previews (og:image etc.), so fill in our public address at request time.
  function publicOrigin(c: Context): string {
    const fixed = env.PUBLIC_URL?.trim().replace(/\/+$/, "");
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
  app.get("/source-selection.js", asset("source-selection.js", "text/javascript; charset=utf-8"));
  app.get("/styles.css", asset("styles.css", "text/css; charset=utf-8"));
  const authBundle = d.authBundle ?? "web/auth.js";
  app.get("/auth.js", (c) => {
    if (!existsSync(authBundle)) return c.text("Privy email sign-in is not configured. Run pnpm build:web with a valid VITE_PRIVY_APP_ID.", 404);
    return c.body(readFileSync(authBundle), 200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-cache" });
  });
  const bundle = d.clientBundle ?? "web/client.js";
  app.get("/client.js", (c) => {
    if (!existsSync(bundle)) return c.text("client bundle missing: run pnpm build:web", 404);
    return c.body(readFileSync(bundle), 200, { "content-type": "text/javascript; charset=utf-8" });
  });
  app.get("/health", (c) => c.json({ ok: true, service: "c-sme", network: testnet ? "testnet" : "mainnet" }));

  const networkLabel = testnet ? "Celo Sepolia (test money)" : "Celo mainnet (real money)";
  app.get("/api/config", (c) =>
    c.json({
      network: networkLabel,
      testnet,
      chainId,
      token,
      feeUsd: formatUsd(feeAtomic),
      // On testnet anyone may run the agent with its own test funds. On mainnet that needs an admin token.
      freeRunAllowed: testnet,
      agentWallet: env.SELLER_PAY_TO ?? null,
      builderCode: env.ATTRIBUTION_TAG ?? "celo_d0da34839ac6",
      agentId: env.AGENT_ID ?? null, // set after ERC-8004 registration
      repoUrl: env.REPO_URL ?? "https://github.com/jnationj/c-sme",
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

  // Wallets that belong to the team (the agent's own pay-to wallet plus any listed in TEAM_WALLETS) are tests, not customers.
  // They are shown separately so the public numbers never overstate real customer use.
  const team = new Set(
    [env.SELLER_PAY_TO, ...(env.TEAM_WALLETS ?? "").split(",")].map((x) => x?.trim().toLowerCase()).filter((x): x is string => !!x),
  );
  const isTeam = (payer: string) => team.has(payer.toLowerCase());

  // Public proof: real counts from the ledger, no questions or full wallet addresses.
  app.get("/api/proof", (c) => {
    const all = ledger.customerStats({ settledOnly: true });
    const customers = all.filter((x) => !isTeam(x.payer));
    const teamTestReports = all.filter((x) => isTeam(x.payer)).reduce((a, x) => a + x.runs, 0);
    const paidUsd = customers.reduce((a, x) => a + x.paidAtomic, 0n);
    const n = (sql: string) => (ledger.db.prepare(sql).get() as { n: number }).n;
    const providerPurchases = n("SELECT COUNT(*) AS n FROM payments WHERE direction = 'out' AND status = 'settled'");
    const dataSpent = (ledger.db.prepare("SELECT amount FROM payments WHERE direction = 'out' AND status = 'settled'").all() as unknown as { amount: string }[]).reduce((a, r) => a + BigInt(r.amount), 0n);
    const recent = (ledger.db.prepare("SELECT direction, provider, amount, status, tx_hash, created_at FROM payments WHERE status = 'settled' AND tx_hash IS NOT NULL ORDER BY created_at DESC LIMIT 8").all() as Array<Record<string, unknown>>).map((r) => ({
      direction: r.direction,
      provider: r.provider,
      usd: formatUsd(BigInt(r.amount as string)),
      tx: r.tx_hash,
      at: r.created_at,
    }));
    return c.json({
      paidReports: customers.reduce((a, x) => a + x.runs, 0),
      teamTestReports,
      customers: customers.length,
      repeatCustomers: customers.filter((x) => x.runs > 1).length,
      customerPaidUsd: formatUsd(paidUsd),
      providerPurchases,
      onChainPayments: providerPurchases + n("SELECT COUNT(*) AS n FROM payments WHERE direction = 'in' AND status = 'settled'"),
      dataSpentUsd: formatUsd(dataSpent),
      recent,
    });
  });

  const originalPlanSteps = new Map<string, PlanStep[]>();
  const confirmedSourceSelections = new Map<string, string[]>();
  const selectionLocked = new Set<string>();
  const selectionUpdating = new Set<string>();
  const describePlan = (p: {
    id: string;
    question: string;
    totalAtomic: bigint;
    customerAtomic: bigint;
    steps: PlanStep[];
    limitations: string[];
    intent: { originalQuestion: string; normalizedQuestion: string; goal: string; platforms: string[]; topics: string[] };
    clarification?: Array<{ code: string; prompt: string; requiredInput?: string }>;
  }, options = p.steps) => ({
    id: p.id,
    question: p.question,
    intent: {
      originalQuestion: p.intent.originalQuestion,
      normalizedQuestion: p.intent.normalizedQuestion,
      goal: p.intent.goal,
      platforms: p.intent.platforms,
      topics: p.intent.topics,
    },
    ...(p.clarification ? { clarification: p.clarification } : {}),
    dataUsd: formatUsd(p.totalAtomic),
    feeUsd: formatUsd(p.steps.length ? feeAtomic : 0n),
    customerUsd: formatUsd(p.customerAtomic),
    recommendedServiceIds: options.filter((s) => s.recommended !== false).map((s) => s.capabilityId),
    selectedServiceIds: p.steps.map((s) => s.capabilityId),
    limitations: p.limitations,
    steps: options.map((s) => ({
      capabilityId: s.capabilityId,
      title: s.title,
      provider: s.provider,
      why: s.why,
      usd: formatUsd(s.quoteAtomic),
      recommended: s.recommended !== false,
      selected: p.steps.some((selected) => selected.capabilityId === s.capabilityId),
      ...(s.platform ? { platform: s.platform } : {}),
      ...(s.resultLimit !== undefined ? { resultLimit: s.resultLimit } : {}),
    })),
  });

  async function applySourceSelection(planId: string, serviceIds: unknown) {
    const plan = agent.getPlan(planId);
    if (!plan || plan.status !== "proposed") throw new Error("unknown or already used plan");
    if (selectionLocked.has(planId)) throw new Error("this plan has already been submitted for payment; start a new plan to change sources");
    if (selectionUpdating.has(planId)) throw new Error("a source selection is already being checked for this plan");
    selectionUpdating.add(planId);
    try {
      const original = originalPlanSteps.get(planId);
      if (!original) throw new Error("the original proposed sources are unavailable");
      if (!Array.isArray(serviceIds) || serviceIds.length > original.length || serviceIds.some((id) => typeof id !== "string")) {
        throw new Error("serviceIds must be an array of proposed service IDs");
      }
      const originalIds = original.map((step) => step.capabilityId);
      if (new Set(originalIds).size !== originalIds.length) throw new Error("this plan contains duplicate service IDs and cannot be selected safely");
      const requestedIds = serviceIds as string[];
      if (new Set(requestedIds).size !== requestedIds.length || requestedIds.some((id) => !originalIds.includes(id))) {
        throw new Error("selection contains a duplicate or unauthorized service ID");
      }

      const catalog = await (d.getCatalog ?? getCatalog)(true);
      if (selectionLocked.has(planId) || plan.status !== "proposed") {
        throw new Error("this plan has already been submitted for payment; start a new plan to change sources");
      }
      const available: PlanStep[] = [];
      for (const step of original) {
        const cap = catalog.get(step.capabilityId);
        const body = step.body && typeof step.body === "object" && !Array.isArray(step.body)
          ? step.body as Record<string, unknown>
          : undefined;
        const tier = body?.maxResults === undefined
          ? undefined
          : cap?.tiers.find((price) => price.maxResults === body.maxResults && (!price.tokens || price.tokens.includes(token)));
        const price = body?.maxResults !== undefined
          ? tier
          : cap?.price && (!cap.price.tokens || cap.price.tokens.includes(token))
            ? cap.price
            : undefined;
        const gatewayUrl = (() => {
          try {
            return new URL(step.url).origin === "https://gateway.usebuy.ai";
          } catch {
            return false;
          }
        })();
        if (
          !cap?.available ||
          cap.id !== step.capabilityId ||
          cap.url !== step.url ||
          cap.method.toUpperCase() !== "POST" ||
          !gatewayUrl ||
          !policyCfg.allowedProviders.has(step.provider.toLowerCase()) ||
          (cap.provider && cap.provider.toLowerCase() !== step.provider.toLowerCase()) ||
          !policyCfg.allowedTokens.has(token) ||
          !price ||
          !/^\d+$/.test(price.atomic) ||
          BigInt(price.atomic) <= 0n
        ) {
          if (requestedIds.includes(step.capabilityId)) throw new Error(`selected service is no longer available at its approved Buy price: ${step.capabilityId}`);
          continue;
        }
        const schemaErrors = validateCapabilityInput(cap, step.body);
        if (schemaErrors.length) {
          if (requestedIds.includes(step.capabilityId)) {
            throw new Error(`selected request no longer matches the Buy catalogue for ${step.capabilityId}: ${schemaErrors.join("; ")}`);
          }
          continue;
        }
        available.push({ ...step, quoteAtomic: BigInt(price.atomic) });
      }

      const selected = available.filter((step) => requestedIds.includes(step.capabilityId));
      const totalAtomic = selected.reduce((total, step) => total + step.quoteAtomic, 0n);
      if (policyCfg.killSwitch && selected.length) throw new Error("spending is currently disabled by the safety policy");
      if (ledger.spentForTask(planId) + totalAtomic > policyCfg.perTaskCap) throw new Error("selected sources exceed the per-report spending limit");
      if (ledger.spentSince(startOfUtcDay()) + totalAtomic > policyCfg.dailyCap) throw new Error("selected sources exceed the daily spending limit");

      plan.steps = selected;
      plan.totalAtomic = totalAtomic;
      plan.customerAtomic = selected.length ? totalAtomic + feeAtomic : 0n;
      plan.progress = selected.map(() => ({ state: "pending" as const, tx: null }));
      originalPlanSteps.set(planId, available);
      return describePlan(plan, available);
    } finally {
      selectionUpdating.delete(planId);
    }
  }

  app.post("/api/plan", async (c) => {
    const body = await c.req.json<{ question?: string }>().catch(() => ({}) as { question?: string });
    const question = body.question;
    if (!question || typeof question !== "string" || question.length > 500) return c.json({ error: "question required (max 500 chars)" }, 400);
    try {
      const plan = await agent.propose(question);
      const options = plan.steps.map((step) => ({ ...step }));
      originalPlanSteps.set(plan.id, options);
      plan.steps = options.filter((step) => step.recommended !== false);
      plan.totalAtomic = plan.steps.reduce((total, step) => total + step.quoteAtomic, 0n);
      plan.customerAtomic = plan.steps.length ? plan.totalAtomic + feeAtomic : 0n;
      plan.progress = plan.steps.map(() => ({ state: "pending" as const, tx: null }));
      return c.json(describePlan(plan, options));
    } catch (e) {
      return c.json({ error: (e as Error).message }, 502);
    }
  });

  app.post("/api/selection", async (c) => {
    const body = await c.req.json<{ planId?: string; serviceIds?: unknown }>().catch(() => ({} as { planId?: string; serviceIds?: unknown }));
    try {
      const planId = body.planId ?? "";
      const selected = await applySourceSelection(planId, body.serviceIds);
      confirmedSourceSelections.set(planId, selected.selectedServiceIds);
      return c.json(selected);
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
      dashboard: result.report.dashboard,
    });
  }

  // Operator-only: runs the plan using the agent's own funds. Open on testnet, locked on mainnet.
  app.post("/api/approve", async (c) => {
    if (!testnet && (!adminToken || c.req.header("x-admin-token") !== adminToken)) {
      return c.json({ error: "forbidden: on mainnet the customer must pay via /api/run" }, 403);
    }
    const body = await c.req.json<{ planId?: string; serviceIds?: unknown }>().catch(() => ({} as { planId?: string; serviceIds?: unknown }));
    try {
      const planId = body.planId ?? "";
      const serviceIds = confirmedSourceSelections.get(planId);
      if (!serviceIds) throw new Error("review and select data sources before approving a purchase");
      if (body.serviceIds !== undefined && (
        !Array.isArray(body.serviceIds) ||
        body.serviceIds.length !== serviceIds.length ||
        body.serviceIds.some((id) => typeof id !== "string" || !serviceIds.includes(id))
      )) {
        throw new Error("the approved selection does not match the reviewed sources");
      }
      const selected = await applySourceSelection(planId, serviceIds);
      confirmedSourceSelections.set(planId, selected.selectedServiceIds);
      if (!selected.selectedServiceIds.length) throw new Error("select at least one data source before approving a purchase");
      selectionLocked.add(planId);
      const result = await agent.approve(planId);
      persist(result, null, false);
      return c.json({ ...result, receipt: hasDeliverable(result.payments) });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
  });

  const explorerTx = testnet ? "https://celo-sepolia.blockscout.com/tx/" : "https://celoscan.io/tx/";
  // Both receipt routes (HTML and JSON) read from here, so they cannot disagree about what may be shown.
  // A customer payment (customerAtomic !== null) must be recorded as "settled" before the question or report leave the
  // server. Operator/test runs (customerAtomic === null) have no customer payment and keep their normal receipt.
  // "settled" is the ledger's status (facilitator-reported success plus a well-formed hash); it is not checked on-chain here.
  function receiptFor(planId: string): ReceiptView | WithheldReceiptView | undefined {
    const r = ledger.getReport(planId);
    if (!r) return undefined;
    const inRow = ledger.getPayment("in:" + planId);
    if (r.customerAtomic !== null && inRow?.status !== "settled") {
      const status = inRow?.status ?? null;
      return {
        withheld: true,
        planId: r.planId,
        network: networkLabel,
        explorerTx,
        createdAt: r.createdAt,
        customerUsd: formatUsd(r.customerAtomic),
        customerStatus: status,
        customerTx: inRow?.txHash ?? null,
        message:
          status === "failed"
            ? "Your payment was not settled, so this report is not available."
            : "Your payment has not been confirmed as settled yet, so the report is not shown. Please check again shortly.",
      };
    }
    return {
      planId: r.planId,
      question: r.question,
      report: r.report,
      dashboard: r.dashboard,
      writtenBy: r.writtenBy,
      network: networkLabel,
      explorerTx,
      createdAt: r.createdAt,
      dataUsd: formatUsd(r.dataAtomic),
      customerUsd: r.customerAtomic === null ? null : formatUsd(r.customerAtomic),
      payer: r.payer,
      customerTx: inRow?.txHash ?? null,
      customerStatus: inRow?.status ?? null,
      purchases: (r.payments as Array<{ ref?: string; title: string; usd: string; status: string; tx: string | null }>).map((p) => ({ ref: p.ref, title: p.title, usd: p.usd, status: p.status, tx: p.tx })),
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
      ledger.customerStats({ settledOnly: true }).filter((x) => !isTeam(x.payer)).map((x) => ({
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
      network: networkLabel,
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

  const payTo = env.SELLER_PAY_TO;
  if (payTo) {
    // Customer pays (data cost + our fee) in USDC on Sepolia / USA₮ on mainnet, then the agent runs.
    // x402 settles only after the handler succeeds, so a failed run is not charged.
    // Outermost layer for /api/run/*: guards the plan, stops serving if customer settlements keep failing,
    // and after the x402 middleware has settled (or failed to) reconciles the ledger from the settlement result.
    const gate = new RunGate(parsePositiveInt("MAX_UNSETTLED_RUNS", env.MAX_UNSETTLED_RUNS, 3));
    app.use("/api/run/*", async (c, next) => {
      const id = c.req.path.split("/").pop() ?? "";
      const p = agent.getPlan(id);
      if (!p || p.status !== "proposed" || !p.steps.length) return c.json({ error: "unknown or already used plan" }, 404);
      const selectedIds = confirmedSourceSelections.get(id);
      if (!selectedIds || selectedIds.length === 0) return c.json({ error: "review and select data sources before approving a purchase" }, 400);
      if (selectionLocked.has(id)) {
        const planIds = p.steps.map((step) => step.capabilityId);
        if (planIds.length !== selectedIds.length || planIds.some((serviceId) => !selectedIds.includes(serviceId))) {
          return c.json({ error: "the reviewed sources no longer match this payment; start a new plan" }, 409);
        }
      } else {
        try {
          await applySourceSelection(id, selectedIds);
        } catch (e) {
          return c.json({ error: (e as Error).message }, 409);
        }
      }
      if (!p.steps.length) return c.json({ error: "no selected source is available to purchase" }, 409);
      // A wallet cannot pay itself: the facilitator refuses it after our agent has already bought data. Refuse up front.
      if (isSelfPayment(c.req.header("payment-signature") ?? c.req.header("x-payment"), payTo)) {
        return c.json({ error: "The paying wallet and the receiving wallet are the same address, so this payment cannot settle. Please pay from a different wallet. Nothing was charged." }, 400);
      }
      // Bounded exposure: each run spends provider money before the customer's payment settles, so stop
      // accepting new runs once too many earlier customer payments failed or are still unconfirmed.
      // The slot is reserved here, before any provider spend, and released only after reconciliation.
      // Failures are counted over the last hour only, so one bad afternoon cannot lock the service forever.
      if (!gate.tryEnter(ledger.countIncomingSince("failed", 3_600_000) + ledger.countIncoming("submitted", 5 * 60_000))) {
        return c.json({ error: "temporarily unavailable, please try again later" }, 503);
      }
      selectionLocked.add(id);
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
        { testnet, payTo, apiKey: env.X402_API_KEY, builderCode: env.ATTRIBUTION_TAG ?? "celo_d0da34839ac6" },
        "POST /api/run/*",
        (path) => agent.getPlan(path.split("/").pop() ?? "")?.customerAtomic,
        "cPilot research report",
      ),
    );
    app.post("/api/run/:planId", async (c) => {
      const planId = c.req.param("planId");
      const plan = agent.getPlan(planId);
      const payer = payerFromHeader(c.req.header("payment-signature") ?? c.req.header("x-payment"));
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

  return app;
}
