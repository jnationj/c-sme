import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createApp } from "../src/app.js";
import { Ledger } from "../src/ledger/ledger.js";
import { Orchestrator, policyFromEnv } from "../src/agent/orchestrator.js";
import { BuyError, type BuyResult } from "../src/agent/buyClient.js";
import { parseUsd } from "../src/chain/tokens.js";
import type { PlanStep } from "../src/agent/planner.js";
import type { Capability } from "../src/agent/catalog.js";

const videos = [
  { id: "1", title: "7 hooks to use for AI videos #aitools #fyp", views: 12000, likes: 900, channel: { username: "abc", followers: 5400 }, postPage: "https://www.tiktok.com/@abc/video/1" },
  { id: "2", title: "How to make AI videos in 5 minutes #aitools", views: 45000, likes: 3000, channel: { username: "def", followers: 20000 } },
  { id: "3", title: "Stop making this AI video mistake?", views: 800, likes: 40, channel: { username: "ghi", followers: 300 } },
];
const TX = "0x" + "a".repeat(64);
type PayFn = (a: { url: string; body: unknown; maxAtomic: bigint }) => Promise<BuyResult>;
const okPay: PayFn = async ({ maxAtomic }) => ({ transaction: TX, paidAtomic: maxAtomic.toString(), token: "USDC", output: videos });

const steps = (): PlanStep[] => [
  { capabilityId: "c1", title: "Tiktok · Trends", provider: "tikhub", url: "https://gateway.usebuy.ai/v1/services/c1", body: {}, quoteAtomic: 5000n, why: "Trending hashtags" },
  { capabilityId: "c2", title: "Tiktok · Scraper", provider: "apify", url: "https://gateway.usebuy.ai/v1/services/c2", body: {}, quoteAtomic: 9000n, why: "Recent videos" },
];

function fakeCatalog(planSteps: PlanStep[]) {
  return new Map(planSteps.map((step) => {
    const atomic = step.capabilityId === "c1" ? "5000" : "9000";
    const capability: Capability = {
      id: step.capabilityId,
      title: step.title,
      method: "POST",
      url: step.url,
      platform: "TikTok",
      available: true,
      provider: step.provider,
      inputSchema: {},
      price: { usd: step.capabilityId === "c1" ? "0.005" : "0.009", atomic, tokens: ["USDC", "USAT"] },
      tiers: [],
    };
    return [step.capabilityId, capability];
  }));
}

function make(o: { testnet?: boolean; adminToken?: string; env?: Record<string, string | undefined>; pay?: PayFn; planSteps?: PlanStep[]; getCatalog?: () => Promise<Map<string, Capability>> } = {}) {
  delete process.env.DEEPSEEK_API_KEY; // the report must fall back to the computed version, never call out
  delete process.env.ANTHROPIC_API_KEY;
  const testnet = o.testnet ?? true;
  const token = testnet ? "USDC" : "USAT";
  const ledger = new Ledger();
  const policyCfg = policyFromEnv(token);
  const feeAtomic = parseUsd("0.02");
  const agent = new Orchestrator({
    ledger,
    policy: policyCfg,
    token,
    account: "test",
    sandbox: testnet,
    feeAtomic,
    pay: o.pay ?? okPay,
    planFn: async (q) => (q.includes("nothing") ? [] : (o.planSteps ?? steps())),
    followUpFn: async () => [],
  });
  const app = createApp({
    testnet,
    chainId: testnet ? 11142220 : 42220,
    token,
    feeAtomic,
    adminToken: o.adminToken,
    ledger,
    agent,
    policyCfg,
    env: o.env ?? {},
    webDir: resolve("src/web") + "/",
    getCatalog: o.getCatalog ?? (async () => fakeCatalog(o.planSteps ?? steps())),
  });
  return { app, ledger, agent };
}

type App = ReturnType<typeof make>["app"];
const post = (app: App, path: string, body: unknown, headers: Record<string, string> = {}) =>
  app.request(path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const json = async (r: Response) => (await r.json()) as any;

async function planAndRun(app: App, question = "What hooks work for small AI creators on TikTok?") {
  const plan = await json(await post(app, "/api/plan", { question }));
  const selected = await post(app, "/api/selection", { planId: plan.id, serviceIds: plan.selectedServiceIds });
  if (!selected.ok) throw new Error("could not select plan sources");
  const run = await post(app, "/api/approve", { planId: plan.id, serviceIds: plan.selectedServiceIds });
  return { plan, run, body: await json(run) };
}

describe("pages and config", () => {
  it("serves the page with absolute social-preview URLs filled in", async () => {
    const { app } = make({ env: { PUBLIC_URL: "https://demo.example/" } });
    const r = await app.request("/");
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain("<title>cPilot");
    expect(html).toContain('og:image" content="https://demo.example/og.png"');
    expect(html).not.toContain("__PUBLIC_URL__");
  });

  it("describes the data source honestly: third-party providers, never an official API", async () => {
    const html = await (await make().app.request("/")).text();
    expect(html).not.toMatch(/(TikTok|Instagram) API/i);
    expect(html).toMatch(/third-party providers/i);
    expect(html).toMatch(/not from TikTok or Instagram directly/i);
    expect(html).toMatch(/have not verified how those providers collect/i);
    expect(html).toMatch(/by hand for free/i);
  });

  it("serves the static assets and a health check", async () => {
    const { app } = make();
    for (const p of ["/app.js", "/source-selection.js", "/styles.css", "/og.png", "/health"]) expect((await app.request(p)).status, p).toBe(200);
    expect(await json(await app.request("/health"))).toMatchObject({ ok: true, network: "testnet" });
    expect([200, 404]).toContain((await app.request("/client.js")).status); // the bundle exists only after pnpm build:web
    const auth = await app.request("/auth.js");
    expect(auth.status).toBe(existsSync(resolve("web/auth.js")) ? 200 : 404);
    if (auth.status === 200) expect(auth.headers.get("content-type")).toContain("text/javascript");
  });

  it("uses supported Try One prompts and gates Pay on server-confirmed selection", async () => {
    const appJs = await (await make().app.request("/app.js")).text();
    for (const prompt of [
      "Find Instagram posts about Ankara fashion and styling.",
      "What hooks and formats work best for small AI content creators on TikTok?",
      "Find popular Instagram hashtags related to fashion.",
      "Which AI video tools are trending on TikTok this week?",
    ]) {
      expect(prompt.length).toBeLessThanOrEqual(500);
      expect(appJs).toContain(`"${prompt}"`);
    }
    expect(appJs).toContain("updateSourceSelection(sourceSelection.ids())");
    expect(appJs).toContain("selectionConfirmation.submit(planId, requestedIds");
    expect(appJs).toContain("selectionState.busy || !selectionState.valid");
    expect(appJs).not.toContain("What are Lagos fashion sellers posting on Instagram");
    expect(appJs).not.toContain("most active ankara tops sellers on Instagram in Lagos");
  });

  it("describes the testnet and mainnet setups truthfully", async () => {
    const t = await json(await make({ env: { SELLER_PAY_TO: "0xabc", AGENT_ID: "existing-agent-id", ATTRIBUTION_TAG: "existing_attribution" } }).app.request("/api/config"));
    expect(t).toMatchObject({ testnet: true, token: "USDC", freeRunAllowed: true, agentWallet: "0xabc", agentId: "existing-agent-id", builderCode: "existing_attribution", feeUsd: "0.02", limits: { perCallUsd: "0.05" } });
    const m = await json(await make({ testnet: false }).app.request("/api/config"));
    expect(m).toMatchObject({ testnet: false, token: "USAT", freeRunAllowed: false, chainId: 42220 });
  });
});

describe("planning", () => {
  it("returns structured clarification instead of proposing paid sources for ambiguous questions", async () => {
    const { app } = make();
    const originalQuestion = "What tools are trending?";
    const response = await json(await post(app, "/api/plan", { question: originalQuestion }));
    expect(response.intent).toMatchObject({
      originalQuestion,
      normalizedQuestion: originalQuestion,
      goal: "trends",
    });
    expect(response.intent.platforms).toEqual([]);
    expect(response.steps).toEqual([]);
    expect(response.selectedServiceIds).toEqual([]);
    expect(response.clarification).toContainEqual(expect.objectContaining({
      code: "ambiguous_platform",
      requiredInput: "platform",
    }));
  });

  it("rejects a missing, oversized or malformed question", async () => {
    const { app } = make();
    expect((await post(app, "/api/plan", {})).status).toBe(400);
    expect((await post(app, "/api/plan", { question: "x".repeat(501) })).status).toBe(400);
    expect((await app.request("/api/plan", { method: "POST", body: "not json" })).status).toBe(400);
  });

  it("quotes data cost plus the fee", async () => {
    const { app } = make();
    const p = await json(await post(app, "/api/plan", { question: "hooks for AI creators on TikTok" }));
    expect(p).toMatchObject({ dataUsd: "0.014", feeUsd: "0.02", customerUsd: "0.034" });
    expect(p.steps).toHaveLength(2);
    expect(p.steps[0]).toMatchObject({ provider: "tikhub", usd: "0.005" });
  });

  it("preselects only recommended sources and reprices a user-modified selection", async () => {
    const proposed = steps().map((step, index) => ({ ...step, recommended: index === 0 }));
    const { app } = make({ planSteps: proposed });
    const p = await json(await post(app, "/api/plan", { question: "What hooks work for small AI creators on TikTok?" }));
    expect(p).toMatchObject({ dataUsd: "0.005", feeUsd: "0.02", customerUsd: "0.025" });
    expect(p.recommendedServiceIds).toEqual(["c1"]);
    expect(p.selectedServiceIds).toEqual(["c1"]);
    expect(p.steps).toHaveLength(2);
    expect(p.steps[1]).toMatchObject({ recommended: false, selected: false });

    const changed = await json(await post(app, "/api/selection", { planId: p.id, serviceIds: ["c2"] }));
    expect(changed).toMatchObject({ dataUsd: "0.009", feeUsd: "0.02", customerUsd: "0.029", selectedServiceIds: ["c2"] });
  });

  it("uses refreshed server catalogue prices instead of the original quote", async () => {
    const currentCatalog = new Map([...fakeCatalog(steps())].map(([id, capability]) => [
      id,
      { ...capability, price: { ...capability.price!, usd: "0.007", atomic: "7000" } },
    ]));
    const { app } = make({ getCatalog: async () => currentCatalog });
    const p = await json(await post(app, "/api/plan", { question: "What hooks work for small AI creators on TikTok?" }));
    const quote = await json(await post(app, "/api/selection", { planId: p.id, serviceIds: ["c1"] }));
    expect(quote).toMatchObject({ dataUsd: "0.007", feeUsd: "0.02", customerUsd: "0.027" });
  });

  it("does not buy before explicit approval and rejects unproposed selections", async () => {
    let purchases = 0;
    const { app } = make({ pay: async ({ maxAtomic }) => {
      purchases++;
      return { transaction: TX, paidAtomic: maxAtomic.toString(), token: "USDC", output: videos };
    } });
    const p = await json(await post(app, "/api/plan", { question: "What hooks work for small AI creators on TikTok?" }));
    expect((await post(app, "/api/approve", { planId: p.id, serviceIds: p.selectedServiceIds })).status).toBe(400);
    expect((await post(app, "/api/selection", { planId: p.id, serviceIds: ["not-proposed"] })).status).toBe(400);
    expect((await post(app, "/api/selection", { planId: p.id, serviceIds: p.selectedServiceIds })).status).toBe(200);
    expect(purchases).toBe(0);
    expect((await post(app, "/api/approve", { planId: p.id, serviceIds: [] })).status).toBe(400);
    expect(purchases).toBe(0);
    const approved = await post(app, "/api/approve", { planId: p.id, serviceIds: p.selectedServiceIds });
    expect(approved.status).toBe(200);
    expect(purchases).toBe(2);
  });

  it("does not create a report or receipt from a paid but unusable provider response", async () => {
    const { app } = make({
      pay: async ({ maxAtomic }) => ({
        transaction: TX,
        paidAtomic: maxAtomic.toString(),
        token: "USDC",
        output: { success: false, error: "provider unavailable" },
      }),
    });
    const plan = await json(await post(app, "/api/plan", { question: "What hooks work for small AI creators on TikTok?" }));
    await post(app, "/api/selection", { planId: plan.id, serviceIds: plan.selectedServiceIds });
    const response = await post(app, "/api/approve", { planId: plan.id, serviceIds: plan.selectedServiceIds });
    const result = await json(response);
    expect(response.status).toBe(200);
    expect(result.receipt).toBe(false);
    expect(result.report.text).not.toContain("[S1]");
    expect((await app.request("/r/" + plan.id)).status).toBe(404);
  });

  it("charges nothing when no source matches", async () => {
    const { app } = make();
    const p = await json(await post(app, "/api/plan", { question: "nothing matches this" }));
    expect(p.steps).toEqual([]);
    expect(p.customerUsd).toBe("0");
  });
});

describe("a full run (operator test-funds path)", () => {
  it("buys the data, writes a cited report, and leaves a receipt and proof", async () => {
    const { app } = make();
    const { plan, run, body } = await planAndRun(app);
    expect(run.status).toBe(200);
    expect(body.receipt).toBe(true);
    expect(body.payments.map((p: any) => [p.ref, p.status])).toEqual([["S1", "settled"], ["S2", "settled"]]);
    expect(body.report.text).toContain("## What the data shows");
    expect(body.report.text).toContain("## What this data can't tell you");
    expect(body.report.text).toContain("[S1]");
    expect(body.report.by).toBe("fallback");
    expect(body.report.dashboard.originalQuestion).toBe("What hooks work for small AI creators on TikTok?");
    expect(body.report.dashboard.quality.recordsAnalyzed).toBe(6);
    expect(body.report.dashboard.sources[0]).toMatchObject({
      ref: "S1",
      provider: "tikhub",
      serviceId: "c1",
      purchase: { amountUsd: "0.005", status: "settled", transaction: TX },
    });
    expect(body.report.dashboard.sources[0].ref).toBe("S1");

    const page = await app.request("/r/" + plan.id);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("What hooks work for small AI creators on TikTok?");
    expect(html).toContain("Run this question again");
    expect(html).toContain("<h4>What the data shows</h4>"); // the report is rendered, not shown as raw markdown
    expect(html).toContain("<li>");
    expect(html).not.toContain("## What the data shows");
    expect(html).toContain("<b>S1</b>");

    expect(await json(await app.request("/api/receipt/" + plan.id))).toMatchObject({
      planId: plan.id,
      dataUsd: "0.014",
      dashboard: { originalQuestion: "What hooks work for small AI creators on TikTok?" },
    });
    const prog = await json(await app.request("/api/progress/" + plan.id));
    expect(prog.stage).toBe("done");
    expect(prog.steps.every((s: any) => s.state === "settled")).toBe(true);
    const proof = await json(await app.request("/api/proof"));
    expect(proof).toMatchObject({ providerPurchases: 2, paidReports: 0, customers: 0 });
    const ledger = await json(await app.request("/api/ledger"));
    expect(ledger.payments.filter((p: any) => p.direction === "out" && p.status === "settled")).toHaveLength(2);
  });

  it("will not run the same plan twice, or an unknown plan", async () => {
    const { app } = make();
    const { plan } = await planAndRun(app);
    expect((await post(app, "/api/approve", { planId: plan.id })).status).toBe(400);
    expect((await post(app, "/api/approve", { planId: "nope" })).status).toBe(400);
    expect((await post(app, "/api/approve", {})).status).toBe(400);
  });

  it("charges nothing and saves no receipt when every purchase fails safely", async () => {
    const { app } = make({
      pay: async () => {
        throw new BuyError("sandbox_payer_budget_exhausted: not charged=true", false);
      },
    });
    const { plan, body } = await planAndRun(app);
    expect(body.receipt).toBe(false);
    expect(body.payments.every((p: any) => p.status === "failed")).toBe(true);
    expect(body.report.text).toMatch(/daily data allowance/);
    expect(body.report.text).toMatch(/Nothing was charged/);
    expect((await app.request("/r/" + plan.id)).status).toBe(404);
    expect(await json(await app.request("/api/proof"))).toMatchObject({ providerPurchases: 0 });
  });

  it("freezes further spending after an uncertain payment (never risk a double payment)", async () => {
    let calls = 0;
    const { app, ledger } = make({
      pay: async () => {
        calls++;
        throw new BuyError("timeout after sending", true);
      },
    });
    const first = await planAndRun(app);
    expect(first.body.payments[0].status).toBe("uncertain");
    expect(first.body.payments).toHaveLength(1); // the run stopped at the first uncertain payment
    expect(ledger.hasUncertain()).toBe(true);
    const callsAfterFirst = calls;

    const second = await planAndRun(app, "another question about TikTok trends");
    expect(second.body.payments.every((p: any) => p.status === "blocked")).toBe(true);
    expect(second.body.payments[0].note).toMatch(/uncertain/);
    expect(calls).toBe(callsAfterFirst); // nothing was even attempted
  });

  it("records each provider payment once per step (idempotent keys) with its transaction hash", async () => {
    const { app, ledger } = make();
    const { plan } = await planAndRun(app);
    for (const i of [0, 1]) {
      const row = ledger.getPayment(`${plan.id}:${i}`);
      expect(row).toMatchObject({ status: "settled", txHash: TX, direction: "out" });
    }
  });

  it("keeps the raw provider output so a report can be re-analysed without paying again", async () => {
    const { app, ledger } = make();
    const { plan } = await planAndRun(app);
    const raw = ledger.getRaw(plan.id);
    expect(raw).toHaveLength(2);
    expect(JSON.stringify(raw[0]!.output)).toContain("7 hooks");
  });
});

describe("public proof never counts the team's own wallets as customers", () => {
  const TEAM = "0x8c3c14616972cc3b06d4e378d5e11a682fc49e35";
  const OTHER = "0x1111111111111111111111111111111111111111";
  const rep = (id: string, payer: string) => ({ planId: id, question: "q", report: "r", writtenBy: "fallback", payments: [], dataAtomic: 19000n, customerAtomic: 39000n, payer });

  const settle = (ledger: Ledger, id: string, status: "settled" | "failed" = "settled") => {
    ledger.createPayment({ idempotencyKey: "in:" + id, taskId: id, direction: "in", provider: "customer", token: "USAT", amount: 39000n, counterparty: null });
    ledger.setStatus("in:" + id, status, status === "settled" ? "0x" + "b".repeat(64) : undefined);
  };

  it("counts a report as paid only if its customer payment settled", async () => {
    const { app, ledger } = make({ env: {} });
    ledger.saveReport(rep("ok", OTHER));
    settle(ledger, "ok");
    ledger.saveReport(rep("refused", OTHER)); // report exists, but the payment was refused
    settle(ledger, "refused", "failed");
    ledger.saveReport(rep("nopayrow", OTHER)); // no payment row at all
    const proof = await json(await app.request("/api/proof"));
    expect(proof).toMatchObject({ paidReports: 1, customers: 1 });
    const page = await (await app.request("/r/refused")).text();
    expect(page).toContain("not settled");
  });

  it("separates team test payments from real customers", async () => {
    const { app, ledger } = make({ env: { SELLER_PAY_TO: TEAM, TEAM_WALLETS: "0x7216D0BC422C6ea3954E167D483879Ff26EBbfCc" } });
    ledger.saveReport(rep("a", TEAM));
    settle(ledger, "a");
    ledger.saveReport(rep("b", "0x7216d0bc422c6ea3954e167d483879ff26ebbfcc"));
    settle(ledger, "b");
    let proof = await json(await app.request("/api/proof"));
    expect(proof).toMatchObject({ paidReports: 0, customers: 0, teamTestReports: 2 });
    expect(await json(await app.request("/api/customers"))).toEqual([]);
    ledger.saveReport(rep("c", OTHER));
    settle(ledger, "c");
    ledger.saveReport(rep("d", OTHER));
    settle(ledger, "d");
    proof = await json(await app.request("/api/proof"));
    expect(proof).toMatchObject({ paidReports: 2, customers: 1, repeatCustomers: 1, teamTestReports: 2 });
    expect((await json(await app.request("/api/customers")))).toHaveLength(1);
  });
});

describe("receipts withhold the question and report until the customer's payment is recorded as settled", () => {
  // Distinctive strings: if any of them appears in a withheld response, something leaked.
  const SECRET_Q = "ZQ-QUESTION-8431 which wig sellers in Surulere are growing fastest";
  const SECRET_R = "ZQ-REPORT-5927 confidential finding about competitor accounts";
  const SECRET_CALL = "ZQ-PROVIDER-CALL-1764";
  const SECRET_PAYER = "0x2222222222222222222222222222222222222222";
  const TXH = "0x" + "c".repeat(64);
  const LEAKS = [SECRET_Q, SECRET_R, SECRET_CALL, SECRET_PAYER, encodeURIComponent(SECRET_Q)];

  type Seeded = ReturnType<typeof make>;
  function seed(m: Seeded, id: string, o: { customerAtomic: bigint | null; payment?: "submitted" | "failed" | "settled" }) {
    m.ledger.saveReport({
      planId: id,
      question: SECRET_Q,
      report: `## What the data shows\n- ${SECRET_R} [S1]`,
      writtenBy: "fallback",
      payments: [{ ref: "S1", title: SECRET_CALL, usd: "0.014", status: "settled", tx: TXH }],
      dataAtomic: 14000n,
      customerAtomic: o.customerAtomic,
      payer: o.customerAtomic === null ? null : SECRET_PAYER,
    });
    if (o.payment) {
      m.ledger.createPayment({ idempotencyKey: "in:" + id, taskId: id, direction: "in", provider: "customer", token: "USAT", amount: 34000n, counterparty: null });
      m.ledger.setStatus("in:" + id, o.payment, o.payment === "settled" ? TXH : undefined);
    }
  }
  const expectNoLeak = (body: string) => {
    for (const s of LEAKS) expect(body, `leaked: ${s}`).not.toContain(s);
  };

  for (const status of ["submitted", "failed"] as const) {
    it(`/api/receipt gives no question or report while the customer payment is ${status}`, async () => {
      const m = make({ env: {} });
      seed(m, "p-" + status, { customerAtomic: 34000n, payment: status });
      const res = await m.app.request("/api/receipt/p-" + status);
      expect(res.status).toBe(200);
      const raw = await res.text();
      expectNoLeak(raw);
      const body = JSON.parse(raw);
      expect(body).toMatchObject({ withheld: true, planId: "p-" + status, customerStatus: status, customerUsd: "0.034" });
      for (const key of ["question", "report", "writtenBy", "purchases", "payer", "dataUsd"]) expect(body, key).not.toHaveProperty(key);
    });

    it(`/r/ page gives no question or report while the customer payment is ${status}`, async () => {
      const m = make({ env: {} });
      seed(m, "h-" + status, { customerAtomic: 34000n, payment: status });
      const res = await m.app.request("/r/h-" + status);
      expect(res.status).toBe(200);
      const html = await res.text();
      expectNoLeak(html);
      expect(html).toContain("not settled");
      expect(html).not.toContain("Run this question again");
    });
  }

  it("a paid report with no payment row at all is withheld too", async () => {
    const m = make({ env: {} });
    seed(m, "norow", { customerAtomic: 34000n });
    expectNoLeak(await (await m.app.request("/api/receipt/norow")).text());
    expectNoLeak(await (await m.app.request("/r/norow")).text());
  });

  it("a settled customer payment still shows the report on both routes", async () => {
    const m = make({ env: {} });
    seed(m, "paid", { customerAtomic: 34000n, payment: "settled" });
    const api = await json(await m.app.request("/api/receipt/paid"));
    expect(api).toMatchObject({ planId: "paid", question: SECRET_Q, customerStatus: "settled", customerTx: TXH });
    expect(api.report).toContain(SECRET_R);
    expect(api.withheld).toBeUndefined();
    const html = await (await m.app.request("/r/paid")).text();
    expect(html).toContain(SECRET_Q);
    expect(html).toContain(SECRET_R);
    expect(html).not.toContain("(not settled)");
  });

  it("an operator/test run (no customer payment) keeps its normal receipt", async () => {
    const m = make({ env: {} });
    seed(m, "ops", { customerAtomic: null });
    const api = await json(await m.app.request("/api/receipt/ops"));
    expect(api).toMatchObject({ planId: "ops", question: SECRET_Q, customerUsd: null, customerStatus: null });
    expect(api.report).toContain(SECRET_R);
    const html = await (await m.app.request("/r/ops")).text();
    expect(html).toContain(SECRET_Q);
    expect(html).toContain(SECRET_R);
    expect(html).toContain("operator test run");
  });
});

describe("mainnet lock and paid route", () => {
  it("never lets an anonymous visitor spend the agent's money on mainnet", async () => {
    const { app } = make({ testnet: false, adminToken: "secret-token" });
    expect((await post(app, "/api/approve", { planId: "x" })).status).toBe(403);
    expect((await post(app, "/api/approve", { planId: "x" }, { "x-admin-token": "guess" })).status).toBe(403);
    expect((await post(app, "/api/approve", { planId: "x" }, { "x-admin-token": "secret-token" })).status).toBe(400); // passed the lock, plan unknown
  });

  it("is locked on mainnet even when no admin token is configured", async () => {
    const { app } = make({ testnet: false });
    expect((await post(app, "/api/approve", { planId: "x" })).status).toBe(403);
    expect((await post(app, "/api/approve", { planId: "x" }, { "x-admin-token": "" })).status).toBe(403);
  });

  it("has no paid route when no pay-to wallet is configured", async () => {
    const { app } = make();
    expect((await app.request("/api/run/abc", { method: "POST" })).status).toBe(404);
  });
});

describe("rate limits", () => {
  const plan = (app: App, ip: string) => post(app, "/api/plan", { question: "hooks for AI creators" }, { "x-forwarded-for": ip });

  it("limits plan requests per visitor and leaves other visitors alone", async () => {
    const { app } = make({ env: { RATE_PLANS_PER_HOUR: "2" } });
    expect([(await plan(app, "1.1.1.1")).status, (await plan(app, "1.1.1.1")).status, (await plan(app, "1.1.1.1")).status]).toEqual([200, 200, 429]);
    expect((await plan(app, "2.2.2.2")).status).toBe(200);
  });

  it("cannot be dodged with a forged first X-Forwarded-For entry (the proxy's entry is the last)", async () => {
    const { app } = make({ env: { RATE_PLANS_PER_HOUR: "1" } });
    expect((await plan(app, "6.6.6.6, 9.9.9.9")).status).toBe(200);
    expect((await plan(app, "7.7.7.7, 9.9.9.9")).status).toBe(429); // same real client (last entry), different forged first entry
  });

  it("limits runs per visitor", async () => {
    const { app } = make({ env: { RATE_RUNS_PER_HOUR: "1" } });
    const run = () => post(app, "/api/approve", { planId: "x" }, { "x-forwarded-for": "3.3.3.3" });
    expect((await run()).status).toBe(400);
    expect((await run()).status).toBe(429);
  });

  it("refuses to start with a nonsense limit instead of silently disabling it", () => {
    expect(() => make({ env: { RATE_PLANS_PER_HOUR: "lots" } })).toThrow(/positive integer/);
  });
});

import { renderReportHtml } from "../src/web/receipt.js";

describe("renderReportHtml (reports contain text from an AI and from data providers: it must never inject markup)", () => {
  it("escapes HTML before formatting anything", () => {
    const html = renderReportHtml('## Title <img src=x onerror=alert(1)>\n- **bold** <script>alert(1)</script> and `code`');
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<code>code</code>");
    expect(html).toContain("<h4>");
    expect(html).toContain("<li>");
  });
  it("renders plain paragraphs and numbered lists", () => {
    const html = renderReportHtml("intro line\n\n1. first\n2. second");
    expect(html).toContain("<p>intro line</p>");
    expect(html).toContain("<ol>");
    expect(html.match(/<li>/g)).toHaveLength(2);
  });
});
