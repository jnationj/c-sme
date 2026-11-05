import { randomUUID } from "node:crypto";
import { Ledger, startOfUtcDay } from "../ledger/ledger.js";
import { evaluateSpend, type PolicyConfig } from "../policy/engine.js";
import { formatUsd, parseUsd } from "../chain/tokens.js";
import { followUpSteps, planSteps, type PlanStep } from "./planner.js";
import { buyCall, BuyError, type BuyResult } from "./buyClient.js";
import { writeReport, type StepResult } from "./report.js";

export interface Plan {
  id: string;
  question: string;
  steps: PlanStep[];
  totalAtomic: bigint;
  /** What the customer pays us: data cost plus our fee. */
  customerAtomic: bigint;
  status: "proposed" | "running" | "done";
  /** Results bought in an earlier stage of the same question (stage 2 reports use them too). */
  prior?: StepResult[];
  /** What the run is doing right now, for the live progress view. */
  stage: "queued" | "buying" | "writing" | "done";
  progress: Array<{ state: "pending" | "paying" | "settled" | "failed" | "blocked" | "uncertain"; tx: string | null }>;
}

export interface OrchestratorOpts {
  ledger: Ledger;
  policy: PolicyConfig;
  token: string;
  account: string;
  sandbox: boolean;
  feeAtomic: bigint;
  /** Optional payer (direct x402). Defaults to the buy CLI. Must enforce the approved max amount itself. */
  pay?: (a: { url: string; body: unknown; maxAtomic: bigint }) => Promise<BuyResult>;
}

export class Orchestrator {
  private plans = new Map<string, Plan>();
  constructor(private o: OrchestratorOpts) {}

  setPayer(pay: OrchestratorOpts["pay"]): void {
    this.o = { ...this.o, pay };
  }

  getPlan(id: string): Plan | undefined {
    return this.plans.get(id);
  }

  get feeAtomic(): bigint {
    return this.o.feeAtomic;
  }

  async propose(question: string): Promise<Plan> {
    const steps = await planSteps(question);
    const plan: Plan = {
      id: randomUUID(),
      question,
      steps,
      totalAtomic: steps.reduce((a, s) => a + s.quoteAtomic, 0n),
      customerAtomic: 0n,
      status: "proposed",
      stage: "queued",
      progress: steps.map(() => ({ state: "pending" as const, tx: null })),
    };
    plan.customerAtomic = steps.length ? plan.totalAtomic + this.o.feeAtomic : 0n;
    this.plans.set(plan.id, plan);
    this.o.ledger.record(
      "plan_proposed",
      { question, steps: steps.map((s) => ({ id: s.capabilityId, usd: formatUsd(s.quoteAtomic) })) },
      plan.id,
    );
    return plan;
  }

  /** The user's approval of the plan is the approval for each step, bounded by that step's quoted price. */
  async approve(planId: string) {
    const plan = this.plans.get(planId);
    if (!plan) throw new Error("unknown plan");
    if (plan.status !== "proposed") throw new Error(`plan already ${plan.status}`);
    if (!plan.steps.length) throw new Error("plan has no purchasable steps");
    plan.status = "running";
    plan.stage = "buying";
    const { ledger, policy, token } = this.o;
    ledger.record("plan_approved", { totalUsd: formatUsd(plan.totalAtomic) }, plan.id);

    const results: StepResult[] = [];
    const bought: StepResult[] = [];
    const log: Array<{ title: string; usd: string; status: string; tx: string | null; note?: string }> = [];
    for (const [i, s] of plan.steps.entries()) {
      const key = `${plan.id}:${i}`;
      const decision = evaluateSpend(
        {
          taskId: plan.id,
          provider: s.provider,
          token,
          quoted: s.quoteAtomic,
          idempotencyKey: key,
          approval: { idempotencyKey: key, maxAmount: s.quoteAtomic, token },
        },
        policy,
        {
          taskSpent: ledger.spentForTask(plan.id),
          daySpent: ledger.spentSince(startOfUtcDay()),
          hasUncertainPayment: ledger.hasUncertain(),
          idempotencyKeyUsed: ledger.keyUsed(key),
        },
      );
      if (!decision.allow) {
        ledger.record("spend_blocked", { step: s.capabilityId, reasons: decision.reasons }, plan.id);
        log.push({ title: s.title, usd: formatUsd(s.quoteAtomic), status: "blocked", tx: null, note: decision.reasons.join("; ") });
        plan.progress[i] = { state: "blocked", tx: null };
        continue;
      }
      ledger.createPayment({
        idempotencyKey: key,
        taskId: plan.id,
        direction: "out",
        provider: s.provider,
        token,
        amount: s.quoteAtomic,
        counterparty: s.url,
      });
      ledger.setStatus(key, "submitted");
      plan.progress[i] = { state: "paying", tx: null };
      try {
        const r = this.o.pay
          ? await this.o.pay({ url: s.url, body: s.body, maxAtomic: s.quoteAtomic })
          : await buyCall({ url: s.url, body: s.body, account: this.o.account, sandbox: this.o.sandbox, token, maxAmount: formatUsd(s.quoteAtomic) });
        ledger.setStatus(key, "settled", r.transaction ?? undefined);
        if (r.paidAtomic && BigInt(r.paidAtomic) > s.quoteAtomic) {
          ledger.record("price_above_quote", { quoted: s.quoteAtomic.toString(), paid: r.paidAtomic }, plan.id);
        }
        plan.progress[i] = { state: "settled", tx: r.transaction };
        results.push({ title: s.title, why: s.why, output: r.output });
        bought.push({ title: s.title, why: s.why, output: r.output });
        log.push({
          title: s.title,
          usd: formatUsd(r.paidAtomic ? BigInt(r.paidAtomic) : s.quoteAtomic),
          status: "settled",
          tx: r.transaction,
        });
      } catch (e) {
        const maybe = e instanceof BuyError ? e.paymentMayHaveHappened : true;
        ledger.setStatus(key, maybe ? "uncertain" : "failed");
        ledger.record("step_error", { step: s.capabilityId, error: (e as Error).message }, plan.id);
        plan.progress[i] = { state: maybe ? "uncertain" : "failed", tx: null };
        log.push({
          title: s.title,
          usd: formatUsd(s.quoteAtomic),
          status: maybe ? "uncertain" : "failed",
          tx: null,
          note: (e as Error).message.slice(0, 200),
        });
        if (maybe) break; // never keep spending while a payment is uncertain
      }
    }
    plan.status = "done";
    plan.stage = "writing";
    const allResults = [...(plan.prior ?? []), ...results];
    const report = results.length
      ? await writeReport(plan.question, allResults)
      : { text: noReportMessage(log), by: "fallback" as const };
    ledger.record("report_written", { by: report.by, steps: results.length }, plan.id);
    plan.stage = "done";
    let followUp: { id: string; totalUsd: string; customerUsd: string; steps: Array<{ provider: string; why: string; usd: string }> } | undefined;
    if (!plan.prior && results.length) {
      const fs = await followUpSteps(bought);
      if (fs.length) {
        const child: Plan = { id: randomUUID(), question: plan.question, steps: fs, totalAtomic: fs.reduce((a, s) => a + s.quoteAtomic, 0n), customerAtomic: 0n, status: "proposed", prior: allResults, stage: "queued", progress: fs.map(() => ({ state: "pending" as const, tx: null })) };
        child.customerAtomic = child.totalAtomic + this.o.feeAtomic;
        this.plans.set(child.id, child);
        ledger.record("followup_proposed", { parent: plan.id, steps: fs.length }, child.id);
        followUp = { id: child.id, totalUsd: formatUsd(child.totalAtomic), customerUsd: formatUsd(child.customerAtomic), steps: fs.map((s) => ({ provider: s.provider, why: s.why, usd: formatUsd(s.quoteAtomic) })) };
      }
    }
    return { planId: plan.id, report, payments: log, spentUsd: formatUsd(ledger.spentForTask(plan.id)), followUp };
  }
}

export function policyFromEnv(token: string): PolicyConfig {
  return {
    killSwitch: process.env.KILL_SWITCH === "1",
    perCallCap: parseUsd(process.env.POLICY_PER_CALL_USD ?? "0.05"),
    perTaskCap: parseUsd(process.env.POLICY_PER_TASK_USD ?? "0.25"),
    dailyCap: parseUsd(process.env.POLICY_DAILY_USD ?? "1.00"),
    allowedProviders: new Set(["tikhub", "apify", "mrscraper"]),
    allowedTokens: new Set([token]),
  };
}

/** Explain, in plain words, why no report could be made. Failed calls were never charged. */
export function noReportMessage(log: Array<{ status: string; note?: string }>): string {
  const notes = log.map((l) => l.note ?? "").join(" ");
  if (/sandbox_payer_budget_exhausted/.test(notes)) {
    return "The test-network demo has used its daily data allowance, so no data could be bought. It resets at midnight UTC. Nothing was charged. Live (mainnet) runs are not limited this way.";
  }
  if (/insufficient|not enough to cover/i.test(notes)) {
    return "The agent's wallet does not have enough funds to buy this data right now. Nothing was charged. Please try again later.";
  }
  if (log.some((l) => l.status === "blocked")) {
    return "The safety rules blocked the purchase (a spending limit or an unapproved source). Nothing was charged.";
  }
  return "No data could be bought for this question, so there is no report. Nothing was charged. Please try again or rephrase.";
}
