import type { ReportDashboard } from "../agent/report-dashboard.js";

export interface ReceiptView {
  /** Present (false) so a view can be told apart from a WithheldReceiptView. */
  withheld?: false;
  planId: string;
  question: string;
  report: string;
  dashboard?: ReportDashboard;
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
  purchases: Array<{ ref?: string; title: string; usd: string; status: string; tx: string | null }>;
}

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const txLink = (base: string, tx: string | null) =>
  tx && /^0x[0-9a-fA-F]{64}$/.test(tx) ? `<a href="${esc(base + tx)}" target="_blank" rel="noopener">${esc(tx.slice(0, 10))}…</a>` : '<span class="mute">n/a</span>';

/** Inline **bold** and `code` on text that has ALREADY been HTML-escaped. */
const inline = (escaped: string) => escaped.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/`([^`]+)`/g, "<code>$1</code>");

/** A small, safe markdown renderer for reports: headings, bullets, numbered lists, bold, code. Everything is escaped first. */
export function renderReportHtml(text: string): string {
  const out: string[] = [];
  let list: "ul" | "ol" | null = null;
  const closeList = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  for (const raw of String(text).replace(/\r/g, "").split("\n")) {
    const line = raw.trim();
    if (!line) {
      closeList();
      continue;
    }
    const h = /^#{1,4}\s+(.*)$/.exec(line);
    const b = /^[-*•]\s+(.*)$/.exec(line);
    const n = /^\d+[.)]\s+(.*)$/.exec(line);
    if (h) {
      closeList();
      out.push(`<h4>${inline(esc(h[1]))}</h4>`);
    } else if (b || n) {
      const type = b ? "ul" : "ol";
      if (list !== type) {
        closeList();
        out.push(`<${type}>`);
        list = type;
      }
      out.push(`<li>${inline(esc((b ?? n)![1]))}</li>`);
    } else {
      closeList();
      out.push(`<p>${inline(esc(line))}</p>`);
    }
  }
  closeList();
  return out.join("\n");
}

/**
 * What a receipt may show while the customer's payment is not confirmed as settled: payment facts only.
 * It carries no question, no report, no data-purchase list and no payer address.
 */
export interface WithheldReceiptView {
  withheld: true;
  planId: string;
  network: string;
  explorerTx: string;
  createdAt: number;
  customerUsd: string;
  /** "submitted" (still being confirmed), "failed", or null when no payment row exists. Never "settled". */
  customerStatus: string | null;
  customerTx: string | null;
  message: string;
}

const RECEIPT_DOC_START = `<!doctype html>
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
pre{white-space:pre-wrap;word-break:break-word;font:inherit;margin:0}.rep h4{margin:14px 0 4px;font-size:1rem}.rep p{margin:6px 0}.rep ul,.rep ol{margin:6px 0 6px 1.2em;padding:0}.rep li{margin:5px 0}.rep code{background:var(--bg);padding:1px 5px;border-radius:5px}.badge{display:inline-block;padding:2px 10px;border-radius:99px;border:1px solid var(--line);font-size:.8rem;color:var(--mute)}
</style></head><body><main>`;

/** Receipt for a customer payment that is not settled: says so, and shows nothing the customer has not paid for. */
function renderWithheldReceipt(v: WithheldReceiptView): string {
  return `${RECEIPT_DOC_START}
<h1>cPilot receipt</h1>
<p class="mute"><span class="badge">${esc(v.network)}</span> ${esc(new Date(v.createdAt).toUTCString())}</p>
<div class="card"><strong>Payment not settled</strong>
<p>${esc(v.message)}</p>
<table><tr><th>Amount</th><th>Status</th><th>Transaction</th></tr>
<tr><td>$${esc(v.customerUsd)}</td><td class="warn">${esc(v.customerStatus ?? "no payment recorded")} (not settled)</td><td>${txLink(v.explorerTx, v.customerTx)}</td></tr></table></div>
<p class="mute"><a href="/">Ask your own question</a></p>
</main></body></html>`;
}

/**
 * Public, shareable receipt. The plan id is an unguessable UUID.
 * A customer payment that is not settled gets the withheld page: no question, no report.
 */
export function renderReceipt(v: ReceiptView | WithheldReceiptView): string {
  if (v.withheld) return renderWithheldReceipt(v);
  const rows = v.purchases
    .map((p) => `<tr><td>${p.ref ? "<b>" + esc(p.ref) + "</b> " : ""}${esc(p.title)}</td><td>$${esc(p.usd)}</td><td class="${p.status === "settled" ? "ok" : "warn"}">${esc(p.status)}</td><td>${txLink(v.explorerTx, p.tx)}</td></tr>`)
    .join("");
  return `${RECEIPT_DOC_START}
<h1>cPilot receipt</h1>
<p class="mute"><span class="badge">${esc(v.network)}</span> ${esc(new Date(v.createdAt).toUTCString())}</p>
<div class="card"><strong>Question</strong><p>${esc(v.question)}</p></div>
<div class="card"><strong>Report</strong> <span class="mute">written by ${esc(v.writtenBy)}</span><div class="rep">${renderReportHtml(v.report)}</div></div>
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
