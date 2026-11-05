import { randomUUID } from "node:crypto";
import { Ledger, startOfUtcDay } from "../ledger/ledger.js";
import { evaluateSpend, type PolicyConfig } from "../policy/engine.js";
import { formatUsd, parseUsd } from "../chain/tokens.js";
import { followUpSteps, planSteps, type PlanStep } from "./planner.js";
import { buyCall, BuyError } from "./buyClient.js";
import { writeReport, type StepResult } from "./report.js";

export interface Plan {
  id: string;
  question: string;
  steps: PlanStep[];
  totalAtomic: bigint;
  status: "proposed" | "running" | "done";
  /** Results bought in an earlier stage of the same question (stage 2 reports use them too). */
  prior?: StepResult[];
}

export interface OrchestratorOpts {
  ledger: Ledger;
  policy: PolicyConfig;
  token: string;
  account: string;
  sandbox: boolean;
}

export class Orchestrator {
  private plans = new Map<string, Plan>();
  constructor(private o: OrchestratorOpts) {}

  async propose(question: string): Promise<Plan> {
    const steps = await planSteps(question);
    const plan: Plan = {
      id: randomUUID(),
      question,
      steps,
      totalAtomic: steps.reduce((a, s) => a + s.quoteAtomic, 0n),
      status: "proposed",
    };
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
      try {
        const r = await buyCall({ url: s.url, body: s.body, account: this.o.account, sandbox: this.o.sandbox, token, maxAmount: formatUsd(s.quoteAtomic) });
        ledger.setStatus(key, "settled", r.transaction ?? undefined);
        if (r.paidAtomic && BigInt(r.paidAtomic) > s.quoteAtomic) {
          ledger.record("price_above_quote", { quoted: s.quoteAtomic.toString(), paid: r.paidAtomic }, plan.id);
        }
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
    const allResults = [...(plan.prior ?? []), ...results];
    const report = results.length
      ? await writeReport(plan.question, allResults)
      : { text: "No data was bought, so there is no report. See the payment log.", by: "fallback" as const };
    ledger.record("report_written", { by: report.by, steps: results.length }, plan.id);
    let followUp: { id: string; totalUsd: string; steps: Array<{ provider: string; why: string; usd: string }> } | undefined;
    if (!plan.prior && results.length) {
      const fs = await followUpSteps(bought);
      if (fs.length) {
        const child: Plan = { id: randomUUID(), question: plan.question, steps: fs, totalAtomic: fs.reduce((a, s) => a + s.quoteAtomic, 0n), status: "proposed", prior: allResults };
        this.plans.set(child.id, child);
        ledger.record("followup_proposed", { parent: plan.id, steps: fs.length }, child.id);
        followUp = { id: child.id, totalUsd: formatUsd(child.totalAtomic), steps: fs.map((s) => ({ provider: s.provider, why: s.why, usd: formatUsd(s.quoteAtomic) })) };
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
