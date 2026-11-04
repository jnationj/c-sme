/**
 * Deterministic spend policy. The LLM may propose a purchase; only this module decides whether it is
 * allowed. Pure function: no I/O, no clock, so every decision is reproducible and unit-testable.
 */

export interface PolicyConfig {
  /** Emergency stop: blocks everything when true. */
  killSwitch: boolean;
  perCallCap: bigint;
  perTaskCap: bigint;
  dailyCap: bigint;
  /** Providers (gateway service ids / hostnames) the agent may pay. Empty set = nothing allowed. */
  allowedProviders: ReadonlySet<string>;
  /** Tokens (6 decimals) we accept paying with. */
  allowedTokens: ReadonlySet<string>;
}

/** State read from the ledger by the caller. */
export interface PolicyState {
  taskSpent: bigint;
  daySpent: bigint;
  /** True if an earlier payment is stuck in "uncertain": reconcile before any further spend. */
  hasUncertainPayment: boolean;
  /** True if this idempotency key was already used. */
  idempotencyKeyUsed: boolean;
}

export interface SpendRequest {
  taskId: string;
  provider: string;
  token: string;
  /** Price from the live quote, atomic units. */
  quoted: bigint;
  idempotencyKey: string;
  /** What the user approved: exact quote and a maximum. Absent = not approved. */
  approval?: { idempotencyKey: string; maxAmount: bigint; token: string };
}

export type Decision = { allow: true } | { allow: false; reasons: string[] };

export function evaluateSpend(req: SpendRequest, cfg: PolicyConfig, st: PolicyState): Decision {
  const reasons: string[] = [];

  if (cfg.killSwitch) reasons.push("kill switch is on");
  if (req.quoted <= 0n) reasons.push("quoted amount must be positive");
  if (!cfg.allowedProviders.has(req.provider)) reasons.push(`provider not allowlisted: ${req.provider}`);
  if (!cfg.allowedTokens.has(req.token)) reasons.push(`token not allowed: ${req.token}`);
  if (req.quoted > cfg.perCallCap) reasons.push("exceeds per-call cap");
  if (st.taskSpent + req.quoted > cfg.perTaskCap) reasons.push("exceeds per-task cap");
  if (st.daySpent + req.quoted > cfg.dailyCap) reasons.push("exceeds daily cap");
  if (st.hasUncertainPayment) reasons.push("an earlier payment is uncertain: reconcile before spending");
  if (st.idempotencyKeyUsed) reasons.push("duplicate idempotency key");

  const a = req.approval;
  if (!a) reasons.push("no user approval");
  else {
    if (a.idempotencyKey !== req.idempotencyKey) reasons.push("approval is for a different purchase");
    if (a.token !== req.token) reasons.push("approval is for a different token");
    if (req.quoted > a.maxAmount) reasons.push("quote exceeds the amount the user approved");
  }

  return reasons.length ? { allow: false, reasons } : { allow: true };
}
