import { DatabaseSync } from "node:sqlite";

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
    `);
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
