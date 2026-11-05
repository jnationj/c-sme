export interface ReceiptView {
  planId: string;
  question: string;
  report: string;
  writtenBy: string;
  network: string;
  explorerTx: string; // e.g. https://celoscan.io/tx/
  createdAt: number;
  dataUsd: string;
  customerUsd: string | null;
  payer: string | null;
  customerTx: string | null;
  /** Status of the customer's payment: only "settled" means money actually moved. */
  customerStatus?: string | null;
  purchases: Array<{ title: string; usd: string; status: string; tx: string | null }>;
}

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const txLink = (base: string, tx: string | null) =>
  tx && /^0x[0-9a-fA-F]{64}$/.test(tx) ? `<a href="${esc(base + tx)}" target="_blank" rel="noopener">${esc(tx.slice(0, 10))}…</a>` : '<span class="mute">n/a</span>';

/** Public, shareable receipt. The plan id is an unguessable UUID; only the report and payment facts are shown. */
export function renderReceipt(v: ReceiptView): string {
  const rows = v.purchases
    .map((p) => `<tr><td>${esc(p.title)}</td><td>$${esc(p.usd)}</td><td class="${p.status === "settled" ? "ok" : "warn"}">${esc(p.status)}</td><td>${txLink(v.explorerTx, p.tx)}</td></tr>`)
    .join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>cPilot receipt</title>
<style>
:root{--bg:#f6f4ef;--card:#fff;--ink:#1c1b19;--mute:#6b675f;--line:#e4e0d6;--acc:#0b6b4f;--warn:#b4570a}
@media(prefers-color-scheme:dark){:root{--bg:#141412;--card:#1d1c19;--ink:#efece4;--mute:#a09b90;--line:#35322b;--acc:#43c59b;--warn:#e69a4a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,sans-serif}
main{max-width:760px;margin:0 auto;padding:20px 16px 60px}h1{font-size:1.4rem;margin:.2em 0}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin:14px 0}
.mute{color:var(--mute)}.ok{color:var(--acc)}.warn{color:var(--warn)}a{color:var(--acc)}
table{width:100%;border-collapse:collapse;font-size:.92rem}td,th{padding:7px 4px;border-bottom:1px solid var(--line);text-align:left}
pre{white-space:pre-wrap;word-break:break-word;font:inherit;margin:0}.badge{display:inline-block;padding:2px 10px;border-radius:99px;border:1px solid var(--line);font-size:.8rem;color:var(--mute)}
</style></head><body><main>
<h1>cPilot receipt</h1>
<p class="mute"><span class="badge">${esc(v.network)}</span> ${esc(new Date(v.createdAt).toUTCString())}</p>
<div class="card"><strong>Question</strong><p>${esc(v.question)}</p></div>
<div class="card"><strong>Report</strong> <span class="mute">written by ${esc(v.writtenBy)}</span><pre style="margin-top:8px">${esc(v.report)}</pre></div>
<div class="card"><strong>What was bought</strong>
<table><tr><th>Data call</th><th>USD</th><th>Status</th><th>Transaction</th></tr>${rows}</table>
<p class="mute">Data cost $${esc(v.dataUsd)}</p></div>
<div class="card"><strong>Customer payment</strong>
<table><tr><th>Paid</th><th>From</th><th>Transaction</th></tr>
<tr><td>${v.customerUsd ? "$" + esc(v.customerUsd) + (v.customerStatus === "settled" ? "" : ' <span class="warn">(not settled)</span>') : "n/a (operator test run)"}</td><td>${v.payer ? esc(v.payer.slice(0, 6) + "…" + v.payer.slice(-4)) : "n/a"}</td><td>${txLink(v.explorerTx, v.customerTx)}</td></tr></table></div>
<p><a class="again" href="/?q=${encodeURIComponent(v.question)}">Run this question again with fresh data</a></p>
<p class="mute">The agent only reports what the purchased data shows and states what it cannot answer. <a href="/">Ask your own question</a></p>
</main></body></html>`;
}
