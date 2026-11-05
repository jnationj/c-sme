export const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>CorridorPilot</title>
<style>
:root{--bg:#f6f4ef;--card:#fff;--ink:#1c1b19;--mute:#6b675f;--line:#e4e0d6;--acc:#0b6b4f;--warn:#b4570a;--bad:#a1281f}
@media(prefers-color-scheme:dark){:root{--bg:#141412;--card:#1d1c19;--ink:#efece4;--mute:#a09b90;--line:#35322b;--acc:#43c59b;--warn:#e69a4a;--bad:#ef7a70}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,sans-serif}
main{max-width:760px;margin:0 auto;padding:20px 16px 60px}h1{font-size:1.5rem;margin:.2em 0}
.sub{color:var(--mute);margin:0 0 18px}.badge{display:inline-block;padding:2px 10px;border-radius:99px;border:1px solid var(--line);font-size:.8rem;color:var(--mute)}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin:14px 0}
textarea{width:100%;min-height:84px;padding:10px;border-radius:8px;border:1px solid var(--line);background:var(--bg);color:var(--ink);font:inherit}
button{background:var(--acc);color:#fff;border:0;border-radius:8px;padding:10px 18px;font:inherit;font-weight:600;cursor:pointer}
button.ghost{background:transparent;color:var(--ink);border:1px solid var(--line)}button:disabled{opacity:.5;cursor:default}
table{width:100%;border-collapse:collapse;font-size:.92rem}td,th{padding:7px 4px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
.mute{color:var(--mute)}.ok{color:var(--acc)}.warn{color:var(--warn)}.bad{color:var(--bad)}
pre{white-space:pre-wrap;word-break:break-word;font:inherit;margin:0}.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.ex button{font-weight:400;font-size:.85rem;padding:5px 10px}
</style></head><body><main>
<h1>CorridorPilot</h1>
<p class="sub">Ask a research question. The agent finds paid data sources, shows the exact price, and only pays after you approve. <span class="badge" id="net">...</span></p>

<div class="card">
  <textarea id="q" placeholder="e.g. What hooks and formats work best for small AI-focused TikTok accounts?"></textarea>
  <div class="row" style="margin-top:10px"><button id="go">Find sources and price</button>
  <span class="ex row"><button class="ghost" data-q="Which hashtags and content types are trending for AI image and video tools on TikTok?">AI tools on TikTok</button>
  <button class="ghost" data-q="What are Instagram sellers charging for ankara tops in Lagos?">Ankara prices</button></span></div>
</div>

<div class="card" id="planBox" hidden>
  <strong>Proposed plan</strong> <span class="mute" id="planNote"></span>
  <table id="planTbl"></table>
  <p><strong>Total: <span id="total"></span></strong> <span class="mute">(nothing is paid yet)</span></p>
  <div class="row"><button id="approve">Approve and pay</button><button class="ghost" id="cancel">Cancel</button></div>
</div>

<div class="card" id="repBox" hidden><strong>Report</strong> <span class="mute" id="by"></span><pre id="rep" style="margin-top:8px"></pre>
  <table id="payTbl" style="margin-top:12px"></table></div>

<div class="card"><strong>Audit ledger</strong> <span class="mute">(every payment the agent has made)</span>
  <table id="led"><tr><td class="mute">loading...</td></tr></table></div>
<script>
const $=id=>document.getElementById(id);let plan=null;
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const j=async(u,o)=>{const r=await fetch(u,o);const d=await r.json();if(!r.ok)throw new Error(d.error||r.status);return d};
const cls=s=>s==='settled'?'ok':(s==='failed'||s==='blocked')?'bad':'warn';
async function ledger(){try{const d=await j('/api/ledger');$('net').textContent=d.network;
 $('led').innerHTML='<tr><th>When</th><th>Provider</th><th>USD</th><th>Status</th><th>Tx</th></tr>'+(d.payments.map(p=>'<tr><td>'+new Date(p.createdAt).toLocaleTimeString()+'</td><td>'+esc(p.provider)+'</td><td>'+esc(p.usd)+'</td><td class="'+cls(p.status)+'">'+esc(p.status)+'</td><td class="mute">'+(p.txHash?esc(p.txHash.slice(0,10))+'...':'')+'</td></tr>').join('')||'<tr><td class="mute">no payments yet</td></tr>')}catch(e){}}
document.querySelectorAll('.ex button').forEach(b=>b.onclick=()=>{$('q').value=b.dataset.q});
$('go').onclick=async()=>{const q=$('q').value.trim();if(!q)return;$('go').disabled=true;$('repBox').hidden=true;
 try{plan=await j('/api/plan',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({question:q})});
  $('planTbl').innerHTML='<tr><th>Source</th><th>Why</th><th>Price</th></tr>'+plan.steps.map(s=>'<tr><td>'+esc(s.provider)+'</td><td>'+esc(s.why)+'</td><td>$'+esc(s.usd)+'</td></tr>').join('');
  $('total').textContent='$'+plan.totalUsd;$('planNote').textContent=plan.steps.length+' paid calls';$('approve').disabled=!plan.steps.length;
  if(!plan.steps.length)$('planNote').textContent='no matching live source found';$('planBox').hidden=false}
 catch(e){alert(e.message)}$('go').disabled=false};
$('cancel').onclick=()=>{$('planBox').hidden=true;plan=null};
$('approve').onclick=async()=>{if(!plan)return;$('approve').disabled=true;$('approve').textContent='Paying... (about 10s per call)';
 try{const d=await j('/api/approve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({planId:plan.id})});
  $('rep').textContent=d.report.text;$('by').textContent='written by '+d.report.by+' - spent $'+d.spentUsd;
  $('payTbl').innerHTML='<tr><th>Call</th><th>USD</th><th>Status</th></tr>'+d.payments.map(p=>'<tr><td>'+esc(p.title)+'</td><td>'+esc(p.usd)+'</td><td class="'+cls(p.status)+'">'+esc(p.status)+(p.note?' - '+esc(p.note):'')+'</td></tr>').join('');
  $('repBox').hidden=false;$('planBox').hidden=true;plan=null;
  if(d.followUp){plan=d.followUp;$('planTbl').innerHTML='<tr><th>Source</th><th>Why</th><th>Price</th></tr>'+plan.steps.map(s=>'<tr><td>'+esc(s.provider)+'</td><td>'+esc(s.why)+'</td><td>$'+esc(s.usd)+'</td></tr>').join('');$('total').textContent='$'+plan.totalUsd;$('planNote').textContent='Follow-up for more detail - '+plan.steps.length+' more paid calls';$('approve').disabled=false;$('planBox').hidden=false}
 }catch(e){alert(e.message)}
 $('approve').textContent='Approve and pay';$('approve').disabled=false;ledger()};
ledger();
</script></main></body></html>`;
