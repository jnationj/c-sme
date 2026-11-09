import { DatabaseSync } from "node:sqlite";
import type { ReportDashboard } from "../agent/report-dashboard.js";

/**
 * Append-only audit ledger plus a payments table. Every economic action must be reconstructable:
 * who asked, what was approved, which provider, exact price, tx hash, result.
 * Uses Node's built-in SQLite, so there is no native dependency to build.
 */

export type PaymentStatus = "approved" | "submitted" | "settled" | "failed" | "uncertain";

export interface PaymentRow {
  idempotencyKey: string;
  taskId: string;
  direction: "out" | "in";
  provider: string;
  token: string;
  amount: bigint;
  status: PaymentStatus;
  txHash: string | null;
  counterparty: string | null;
  createdAt: number;
  updatedAt: number;
}

export class Ledger {
  readonly db: DatabaseSync;

  constructor(path = ":memory:") {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        kind TEXT NOT NULL,
        task_id TEXT,
        data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS payments (
        idempotency_key TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        direction TEXT NOT NULL CHECK (direction IN ('out','in')),
        provider TEXT NOT NULL,
        token TEXT NOT NULL,
        amount TEXT NOT NULL,
        status TEXT NOT NULL,
        tx_hash TEXT,
        counterparty TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS payments_task ON payments(task_id);
      CREATE TABLE IF NOT EXISTS reports (
        plan_id TEXT PRIMARY KEY,
        question TEXT NOT NULL,
        report TEXT NOT NULL,
        written_by TEXT NOT NULL,
        payments TEXT NOT NULL,
        data_atomic TEXT NOT NULL,
        customer_atomic TEXT,
        payer TEXT,
        created_at INTEGER NOT NULL,
        dashboard TEXT
      );
      CREATE INDEX IF NOT EXISTS reports_payer ON reports(payer);
      CREATE TABLE IF NOT EXISTS raw_outputs (
        plan_id TEXT NOT NULL,
        idx INTEGER NOT NULL,
        title TEXT NOT NULL,
        output TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (plan_id, idx)
      );
    `);
    const reportColumns = this.db.prepare("PRAGMA table_info(reports)").all() as Array<{ name: string }>;
    if (!reportColumns.some((column) => column.name === "dashboard")) {
      this.db.exec("ALTER TABLE reports ADD COLUMN dashboard TEXT");
    }
  }

  record(kind: string, data: unknown, taskId?: string, now = Date.now()): void {
    this.db
      .prepare("INSERT INTO events (ts, kind, task_id, data) VALUES (?, ?, ?, ?)")
      .run(now, kind, taskId ?? null, JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
  }

  /** Throws on a duplicate idempotency key (PRIMARY KEY), which is the duplicate-payment guard. */
  createPayment(p: Omit<PaymentRow, "createdAt" | "updatedAt" | "status" | "txHash"> & { status?: PaymentStatus }, now = Date.now()): void {
    this.db
      .prepare(
        `INSERT INTO payments (idempotency_key, task_id, direction, provider, token, amount, status, tx_hash, counterparty, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
      )
      .run(p.idempotencyKey, p.taskId, p.direction, p.provider, p.token, p.amount.toString(), p.status ?? "approved", p.counterparty, now, now);
    this.record("payment.created", { key: p.idempotencyKey, provider: p.provider, amount: p.amount, direction: p.direction }, p.taskId, now);
  }

  setStatus(idempotencyKey: string, status: PaymentStatus, txHash?: string, now = Date.now()): void {
    const r = this.db
      .prepare("UPDATE payments SET status = ?, tx_hash = COALESCE(?, tx_hash), updated_at = ? WHERE idempotency_key = ?")
      .run(status, txHash ?? null, now, idempotencyKey);
    if (r.changes === 0) throw new Error(`unknown payment: ${idempotencyKey}`);
    this.record("payment.status", { key: idempotencyKey, status, txHash }, undefined, now);
  }

  getPayment(idempotencyKey: string): PaymentRow | undefined {
    const r = this.db.prepare("SELECT * FROM payments WHERE idempotency_key = ?").get(idempotencyKey) as Record<string, unknown> | undefined;
    return r && rowToPayment(r);
  }

  /** Outgoing spend that counts against caps: anything not failed. Uncertain counts (it may have settled). */
  spentForTask(taskId: string): bigint {
    return this.sumOut("task_id = ?", [taskId]);
  }

  /** Outgoing spend since `sinceMs` (callers pass the start of the UTC day). */
  spentSince(sinceMs: number): bigint {
    return this.sumOut("created_at >= ?", [sinceMs]);
  }

  hasUncertain(): boolean {
    const r = this.db.prepare("SELECT 1 AS x FROM payments WHERE status = 'uncertain' LIMIT 1").get();
    return r !== undefined;
  }

  saveReport(r: SavedReport, now = Date.now()): void {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO reports (plan_id, question, report, written_by, payments, data_atomic, customer_atomic, payer, created_at, dashboard) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(r.planId, r.question, r.report, r.writtenBy, JSON.stringify(r.payments), r.dataAtomic.toString(), r.customerAtomic?.toString() ?? null, r.payer?.toLowerCase() ?? null, now, r.dashboard ? JSON.stringify(r.dashboard) : null);
    this.record("report.saved", { planId: r.planId, payer: r.payer }, r.planId, now);
  }

  /** Stores the raw provider response (capped) for one purchase. */
  saveRaw(planId: string, idx: number, title: string, output: unknown, now = Date.now()): void {
    const text = JSON.stringify(output ?? null) ?? "null";
    this.db
      .prepare("INSERT OR REPLACE INTO raw_outputs (plan_id, idx, title, output, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(planId, idx, title, text.length > 400_000 ? text.slice(0, 400_000) : text, now);
  }

  getRaw(planId: string): Array<{ idx: number; title: string; output: unknown }> {
    const rows = this.db.prepare("SELECT idx, title, output FROM raw_outputs WHERE plan_id = ? ORDER BY idx").all(planId) as Array<{ idx: number; title: string; output: string }>;
    return rows.map((r) => {
      try {
        return { idx: r.idx, title: r.title, output: JSON.parse(r.output) as unknown };
      } catch {
        return { idx: r.idx, title: r.title, output: null };
      }
    });
  }

  getReport(planId: string): (SavedReport & { createdAt: number }) | undefined {
    const row = this.db.prepare("SELECT * FROM reports WHERE plan_id = ?").get(planId) as Record<string, unknown> | undefined;
    return row && rowToReport(row);
  }

  reportsForPayer(payer: string, limit = 20): Array<SavedReport & { createdAt: number }> {
    const rows = this.db.prepare("SELECT * FROM reports WHERE payer = ? ORDER BY created_at DESC LIMIT ?").all(payer.toLowerCase(), limit) as Record<string, unknown>[];
    return rows.map(rowToReport);
  }

  /** Per-customer usage: how many paid runs and how much, plus first/last activity. Repeat use = runs > 1. */
  customerStats(opts: { settledOnly?: boolean } = {}): Array<{ payer: string; runs: number; paidAtomic: bigint; firstAt: number; lastAt: number }> {
    // settledOnly: a report counts only if its customer payment actually settled (a refused or failed payment is not a paid report).
    const sql = opts.settledOnly
      ? "SELECT r.payer AS payer, r.customer_atomic AS customer_atomic, r.created_at AS created_at FROM reports r JOIN payments p ON p.idempotency_key = 'in:' || r.plan_id WHERE r.payer IS NOT NULL AND p.status = 'settled' ORDER BY r.created_at"
      : "SELECT payer, customer_atomic, created_at FROM reports WHERE payer IS NOT NULL ORDER BY created_at";
    const rows = this.db.prepare(sql).all() as unknown as Array<{ payer: string; customer_atomic: string | null; created_at: number }>;
    const by = new Map<string, { payer: string; runs: number; paidAtomic: bigint; firstAt: number; lastAt: number }>();
    for (const r of rows) {
      const c = by.get(r.payer) ?? { payer: r.payer, runs: 0, paidAtomic: 0n, firstAt: r.created_at, lastAt: r.created_at };
      c.runs += 1;
      c.paidAtomic += BigInt(r.customer_atomic ?? "0");
      c.lastAt = r.created_at;
      by.set(r.payer, c);
    }
    return [...by.values()].sort((a, b) => b.lastAt - a.lastAt);
  }

  /** Customer payments in a status created within the last `windowMs`: a rolling view, so old failures stop counting. */
  countIncomingSince(status: PaymentStatus, windowMs: number, now = Date.now()): number {
    const r = this.db
      .prepare("SELECT COUNT(*) AS n FROM payments WHERE direction = 'in' AND status = ? AND created_at >= ?")
      .get(status, now - windowMs) as { n: number };
    return r.n;
  }

  /** Number of customer (incoming) payments in a status. Used to stop serving when settlements keep failing. */
  countIncoming(status: PaymentStatus, olderThanMs = 0, now = Date.now()): number {
    const r = this.db
      .prepare("SELECT COUNT(*) AS n FROM payments WHERE direction = 'in' AND status = ? AND created_at <= ?")
      .get(status, now - olderThanMs) as { n: number };
    return r.n;
  }

  keyUsed(idempotencyKey: string): boolean {
    return this.getPayment(idempotencyKey) !== undefined;
  }

  private sumOut(where: string, params: (string | number)[]): bigint {
    const rows = this.db
      .prepare(`SELECT amount FROM payments WHERE direction = 'out' AND status != 'failed' AND ${where}`)
      .all(...params) as { amount: string }[];
    return rows.reduce((acc, r) => acc + BigInt(r.amount), 0n);
  }
}

function rowToPayment(r: Record<string, unknown>): PaymentRow {
  return {
    idempotencyKey: r.idempotency_key as string,
    taskId: r.task_id as string,
    direction: r.direction as "out" | "in",
    provider: r.provider as string,
    token: r.token as string,
    amount: BigInt(r.amount as string),
    status: r.status as PaymentStatus,
    txHash: (r.tx_hash as string | null) ?? null,
    counterparty: (r.counterparty as string | null) ?? null,
    createdAt: r.created_at as number,
    updatedAt: r.updated_at as number,
  };
}

export function startOfUtcDay(now = Date.now()): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export interface SavedReport {
  planId: string;
  question: string;
  report: string;
  writtenBy: string;
  payments: unknown;
  dataAtomic: bigint;
  customerAtomic: bigint | null;
  payer: string | null;
  dashboard?: ReportDashboard;
}

function rowToReport(r: Record<string, unknown>): SavedReport & { createdAt: number } {
  return {
    planId: r.plan_id as string,
    question: r.question as string,
    report: r.report as string,
    writtenBy: r.written_by as string,
    payments: JSON.parse(r.payments as string),
    dataAtomic: BigInt(r.data_atomic as string),
    customerAtomic: r.customer_atomic == null ? null : BigInt(r.customer_atomic as string),
    payer: (r.payer as string | null) ?? null,
    ...(typeof r.dashboard === "string" ? { dashboard: JSON.parse(r.dashboard) as ReportDashboard } : {}),
    createdAt: r.created_at as number,
  };
}
