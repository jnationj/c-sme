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
details summary{cursor:pointer;font-weight:600}details ol{margin:8px 0 0;padding-left:20px}
.price td:last-child,.price th:last-child{text-align:right}
</style></head><body><main>
<h1>CorridorPilot</h1>
<p class="sub">Ask a research question. An agent finds paid data sources, shows you the exact price, and only pays after you approve. <span class="badge" id="net">...</span></p>

<details class="card"><summary>How this works (30 seconds)</summary>
<ol>
<li><b>Ask</b> a business question (what's working on TikTok or Instagram).</li>
<li>The agent <b>finds paid data sources</b> and shows each price. Nothing is spent yet.</li>
<li>You <b>approve and pay</b> from your own wallet. Your wallet signs a gasless payment, so you don't need CELO.</li>
<li>The agent <b>buys the data</b> and writes a short report that also says what the data cannot answer.</li>
<li>You only pay if the report is delivered. Every payment is in the ledger at the bottom.</li>
</ol></details>

<div class="card" id="walletCard">
  <div class="row"><button id="connect" class="ghost">Connect wallet</button><span id="who" class="mute">Not connected. Connect the wallet you will pay from.</span></div>
</div>

<div class="card">
  <textarea id="q" placeholder="e.g. What hooks and formats work best for small AI-focused TikTok accounts?"></textarea>
  <div class="row" style="margin-top:10px"><button id="go">Find sources and price</button>
  <span class="ex row"><button class="ghost" data-q="Which hashtags and content types are trending for AI image and video tools on TikTok?">AI tools on TikTok</button>
  <button class="ghost" data-q="Who are the most active ankara tops sellers on Instagram in Lagos and what do their posts look like?">Lagos ankara sellers</button></span></div>
</div>

<div class="card" id="planBox" hidden>
  <strong id="planTitle">Proposed plan</strong> <span class="mute" id="planNote"></span>
  <table id="planTbl" class="price"></table>
  <p style="margin-bottom:4px">Data: <span id="dataUsd"></span> + service fee: <span id="feeUsd"></span></p>
  <p style="margin-top:0"><strong>You pay: <span id="total"></span></strong> <span class="mute">(nothing is paid until you click)</span></p>
  <div class="row"><button id="pay">Pay with my wallet</button><button class="ghost" id="free" hidden>Run with test funds (testnet only)</button><button class="ghost" id="cancel">Cancel</button></div>
  <p class="mute" id="payMsg"></p>
</div>

<div class="card" id="repBox" hidden><strong>Report</strong> <span class="mute" id="by"></span><pre id="rep" style="margin-top:8px"></pre>
  <p id="rcpt" class="mute" style="margin:10px 0 0"></p><table id="payTbl" style="margin-top:12px"></table></div>

<div class="card" id="mineBox" hidden><strong>Your reports</strong> <span class="mute">(saved in this browser only)</span><table id="mine"></table></div>

<div class="card"><strong>Customer activity</strong> <span class="mute">(anonymous: shortened wallets, counts and totals)</span>
  <table id="cust"><tr><td class="mute">loading...</td></tr></table></div>

<div class="card"><strong>Audit ledger</strong> <span class="mute">(every payment, in and out)</span>
  <table id="led"><tr><td class="mute">loading...</td></tr></table></div>
<script src="/client.js"></script>
<script>
const $=id=>document.getElementById(id);let plan=null,cfg=null,addr=null;
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const j=async(u,o)=>{const r=await fetch(u,o);const d=await r.json();if(!r.ok)throw new Error(d.error||r.status);return d};
const cls=s=>s==='settled'?'ok':(s==='failed'||s==='blocked')?'bad':'warn';
async function ledger(){try{const d=await j('/api/ledger');
 $('led').innerHTML='<tr><th>When</th><th>Direction</th><th>With</th><th>USD</th><th>Status</th><th>Tx</th></tr>'+(d.payments.map(p=>'<tr><td>'+new Date(p.createdAt).toLocaleTimeString()+'</td><td>'+(p.direction==='in'?'received':'paid')+'</td><td>'+esc(p.provider)+'</td><td>'+esc(p.usd)+'</td><td class="'+cls(p.status)+'">'+esc(p.status)+'</td><td class="mute">'+(p.txHash?esc(p.txHash.slice(0,10))+'...':'')+'</td></tr>').join('')||'<tr><td class="mute">no payments yet</td></tr>')}catch(e){}}
function showPlan(p,title){plan=p;$('planTitle').textContent=title;
 $('planTbl').innerHTML='<tr><th>Source</th><th>Why</th><th>Price</th></tr>'+p.steps.map(s=>'<tr><td>'+esc(s.provider)+'</td><td>'+esc(s.why)+'</td><td>$'+esc(s.usd)+'</td></tr>').join('');
 $('dataUsd').textContent='$'+p.dataUsd;$('feeUsd').textContent='$'+p.feeUsd;$('total').textContent='$'+p.customerUsd;
 $('planNote').textContent=p.steps.length+' paid calls';$('pay').disabled=!p.steps.length;$('free').disabled=!p.steps.length;$('payMsg').textContent='';$('planBox').hidden=false}
const HKEY='cp_reports';
function mineList(){try{return JSON.parse(localStorage.getItem(HKEY)||'[]')}catch(e){return[]}}
function remember(d){if(!d.planId||!d.report)return;try{const q=($('q').value||'').trim();const l=mineList().filter(x=>x.id!==d.planId);l.unshift({id:d.planId,q:q.slice(0,120),at:Date.now()});localStorage.setItem(HKEY,JSON.stringify(l.slice(0,30)))}catch(e){}renderMine()}
function renderMine(){const l=mineList();$('mineBox').hidden=!l.length;$('mine').innerHTML=l.map(x=>'<tr><td>'+new Date(x.at).toLocaleString()+'</td><td>'+esc(x.q||'report')+'</td><td><a href="/r/'+encodeURIComponent(x.id)+'" target="_blank">receipt</a></td></tr>').join('')}
async function customers(){try{const d=await j('/api/customers');$('cust').innerHTML=d.length?'<tr><th>Customer</th><th>Runs</th><th>Paid</th><th>Last used</th></tr>'+d.map(x=>'<tr><td>'+esc(x.customer)+(x.repeat?' <span class="ok">(repeat)</span>':'')+'</td><td>'+x.runs+'</td><td>$'+esc(x.paidUsd)+'</td><td>'+new Date(x.lastAt).toLocaleString()+'</td></tr>').join(''):'<tr><td class="mute">no paying customers yet</td></tr>'}catch(e){}}
function showResult(d){$('rep').textContent=d.report.text;$('by').textContent='written by '+d.report.by+' - data cost $'+d.spentUsd;
 $('payTbl').innerHTML='<tr><th>Call</th><th>USD</th><th>Status</th></tr>'+d.payments.map(p=>'<tr><td>'+esc(p.title)+'</td><td>'+esc(p.usd)+'</td><td class="'+cls(p.status)+'">'+esc(p.status)+(p.note?' - '+esc(p.note):'')+'</td></tr>').join('');
 $('repBox').hidden=false;$('planBox').hidden=true;plan=null;$('rcpt').innerHTML=d.planId?'<a href="/r/'+encodeURIComponent(d.planId)+'" target="_blank">Open shareable receipt</a>':'';
 if(d.followUp){showPlan({id:d.followUp.id,steps:d.followUp.steps,dataUsd:d.followUp.totalUsd,feeUsd:cfg.feeUsd,customerUsd:d.followUp.customerUsd},'Follow-up for more detail')}
 ledger();customers()}
async function init(){cfg=await j('/api/config');$('net').textContent=cfg.network;$('free').hidden=!cfg.freeRunAllowed;ledger()}
document.querySelectorAll('.ex button').forEach(b=>b.onclick=()=>{$('q').value=b.dataset.q});
$('connect').onclick=async()=>{try{addr=await window.CP.connect(cfg.chainId);$('who').textContent='Connected: '+addr.slice(0,6)+'...'+addr.slice(-4);$('connect').textContent='Connected'}catch(e){alert(e.message)}};
$('go').onclick=async()=>{const q=$('q').value.trim();if(!q)return;$('go').disabled=true;$('repBox').hidden=true;
 try{showPlan(await j('/api/plan',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({question:q})}),'Proposed plan');if(!plan.steps.length)$('planNote').textContent='no matching live source found'}
 catch(e){alert(e.message)}$('go').disabled=false};
$('cancel').onclick=()=>{$('planBox').hidden=true;plan=null};
$('pay').onclick=async()=>{if(!plan)return;if(!addr){$('payMsg').textContent='Connect your wallet first.';return}
 $('pay').disabled=true;$('payMsg').textContent='Check your wallet and sign the payment. Then wait about 10s per data call...';
 try{const {res}=await window.CP.payFetch(addr,'/api/run/'+plan.id,{method:'POST'});const d=await res.json();if(!res.ok)throw new Error(d.error||('HTTP '+res.status));showResult(d)}
 catch(e){$('payMsg').textContent='Not completed: '+e.message}$('pay').disabled=false};
$('free').onclick=async()=>{if(!plan)return;$('free').disabled=true;$('payMsg').textContent='Running with the agent test funds...';
 try{showResult(await j('/api/approve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({planId:plan.id})}))}catch(e){$('payMsg').textContent='Failed: '+e.message}$('free').disabled=false};
init();renderMine();customers();
</script></main></body></html>`;
