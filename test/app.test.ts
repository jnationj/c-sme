import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { createApp } from "../src/app.js";
import { Ledger } from "../src/ledger/ledger.js";
import { Orchestrator, policyFromEnv } from "../src/agent/orchestrator.js";
import { BuyError, type BuyResult } from "../src/agent/buyClient.js";
import { parseUsd } from "../src/chain/tokens.js";
import type { PlanStep } from "../src/agent/planner.js";

const videos = [
  { id: "1", title: "7 hooks to use for AI videos #aitools #fyp", views: 12000, likes: 900, channel: { username: "abc", followers: 5400 }, postPage: "https://www.tiktok.com/@abc/video/1" },
  { id: "2", title: "How to make AI videos in 5 minutes #aitools", views: 45000, likes: 3000, channel: { username: "def", followers: 20000 } },
  { id: "3", title: "Stop making this AI video mistake?", views: 800, likes: 40, channel: { username: "ghi", followers: 300 } },
];
const TX = "0x" + "a".repeat(64);
type PayFn = (a: { url: string; body: unknown; maxAtomic: bigint }) => Promise<BuyResult>;
const okPay: PayFn = async ({ maxAtomic }) => ({ transaction: TX, paidAtomic: maxAtomic.toString(), token: "USDC", output: videos });

const steps = (): PlanStep[] => [
  { capabilityId: "c1", title: "Tiktok · Trends", provider: "tikhub", url: "https://example.test/a", body: {}, quoteAtomic: 5000n, why: "Trending hashtags" },
  { capabilityId: "c2", title: "Tiktok · Scraper", provider: "apify", url: "https://example.test/b", body: {}, quoteAtomic: 9000n, why: "Recent videos" },
];

function make(o: { testnet?: boolean; adminToken?: string; env?: Record<string, string | undefined>; pay?: PayFn } = {}) {
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
    planFn: async (q) => (q.includes("nothing") ? [] : steps()),
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
  });
  return { app, ledger, agent };
}

type App = ReturnType<typeof make>["app"];
const post = (app: App, path: string, body: unknown, headers: Record<string, string> = {}) =>
  app.request(path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const json = async (r: Response) => (await r.json()) as any;

async function planAndRun(app: App, question = "What hooks work for small AI creators on TikTok?") {
  const plan = await json(await post(app, "/api/plan", { question }));
  const run = await post(app, "/api/approve", { planId: plan.id });
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

  it("serves the static assets and a health check", async () => {
    const { app } = make();
    for (const p of ["/app.js", "/styles.css", "/og.png", "/health"]) expect((await app.request(p)).status, p).toBe(200);
    expect(await json(await app.request("/health"))).toMatchObject({ ok: true, network: "testnet" });
    expect([200, 404]).toContain((await app.request("/client.js")).status); // the bundle exists only after pnpm build:web
  });

  it("describes the testnet and mainnet setups truthfully", async () => {
    const t = await json(await make({ env: { SELLER_PAY_TO: "0xabc" } }).app.request("/api/config"));
    expect(t).toMatchObject({ testnet: true, token: "USDC", freeRunAllowed: true, agentWallet: "0xabc", feeUsd: "0.02", limits: { perCallUsd: "0.05" } });
    const m = await json(await make({ testnet: false }).app.request("/api/config"));
    expect(m).toMatchObject({ testnet: false, token: "USAT", freeRunAllowed: false, chainId: 42220 });
  });
});

describe("planning", () => {
  it("rejects a missing, oversized or malformed question", async () => {
    const { app } = make();
    expect((await post(app, "/api/plan", {})).status).toBe(400);
    expect((await post(app, "/api/plan", { question: "x".repeat(501) })).status).toBe(400);
    expect((await app.request("/api/plan", { method: "POST", body: "not json" })).status).toBe(400);
  });

  it("quotes data cost plus the fee", async () => {
    const { app } = make();
    const p = await json(await post(app, "/api/plan", { question: "hooks for AI creators" }));
    expect(p).toMatchObject({ dataUsd: "0.014", feeUsd: "0.02", customerUsd: "0.034" });
    expect(p.steps).toHaveLength(2);
    expect(p.steps[0]).toMatchObject({ provider: "tikhub", usd: "0.005" });
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

    const page = await app.request("/r/" + plan.id);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("What hooks work for small AI creators on TikTok?");
    expect(html).toContain("Run this question again");

    expect(await json(await app.request("/api/receipt/" + plan.id))).toMatchObject({ planId: plan.id, dataUsd: "0.014" });
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
