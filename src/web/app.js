/* CorridorPilot front end. Plain JS. All dynamic text goes through textContent (never innerHTML), so
   provider data and AI text cannot inject markup. */
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var cfg = null;
  var plan = null; // the plan currently shown: { id, steps, dataUsd, feeUsd, customerUsd }
  var addr = null;
  var lastReport = "";
  var pollTimer = null;
  var clock = null;

  /* ---------- tiny DOM helper ---------- */
  function el(tag, attrs) {
    var n = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === "class") n.className = attrs[k];
        else if (k === "text") n.textContent = attrs[k];
        else if (k === "href" && !/^(https?:\/\/|\/)/i.test(attrs[k])) return; // never create javascript: links
        else n.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c == null) continue;
      n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    }
    return n;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  function short(a) { return a ? a.slice(0, 6) + "…" + a.slice(-4) : ""; }
  function usd(s) { return "$" + s; }
  function api(url, opts) {
    return fetch(url, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) { var e = new Error(d.error || ("HTTP " + r.status)); e.status = r.status; e.body = d; throw e; }
        return d;
      });
    });
  }

  /* ---------- views and stepper ---------- */
  var VIEWS = { ask: "vAsk", loading: "vLoading", plan: "vPlan", run: "vRun", report: "vReport" };
  var STEP_OF = { ask: 0, loading: 0, plan: 1, run: 2, report: 3 };
  function show(name) {
    Object.keys(VIEWS).forEach(function (k) { $(VIEWS[k]).hidden = k !== name; });
    document.body.setAttribute("data-view", name === "loading" ? "ask" : name);
    var idx = STEP_OF[name];
    Array.prototype.forEach.call($("stepper").children, function (li, i) {
      li.classList.toggle("active", i === idx);
      li.classList.toggle("done", i < idx);
    });
    var focusId = { plan: "planTitle", run: "runTitle", report: "repTitle" }[name];
    if (focusId) { var f = $(focusId); f.focus({ preventScroll: true }); f.scrollIntoView({ behavior: "smooth", block: "start" }); }
  }
  function alertMsg(msg, kind) {
    var a = $("alert");
    if (!msg) { a.hidden = true; return; }
    a.textContent = msg;
    a.className = "alert" + (kind === "info" ? " info" : "");
    a.hidden = false;
  }

  /* ---------- markdown-lite (safe): headings, bullets, numbers, **bold**, `code` ---------- */
  function inline(parent, text) {
    var re = /(\*\*[^*]+\*\*|`[^`]+`)/g, last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) parent.appendChild(document.createTextNode(text.slice(last, m.index)));
      var tok = m[0];
      parent.appendChild(tok[0] === "`" ? el("code", { text: tok.slice(1, -1) }) : el("strong", { text: tok.slice(2, -2) }));
      last = m.index + tok.length;
    }
    if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
  }
  function renderMarkdown(into, text) {
    clear(into);
    var lines = String(text).replace(/\r/g, "").split("\n");
    var list = null, listType = null, para = null;
    function flushPara() { if (para) { var p = el("p"); inline(p, para.join(" ")); into.appendChild(p); para = null; } }
    function flushList() { list = null; listType = null; }
    lines.forEach(function (raw) {
      var line = raw.trim();
      if (!line) { flushPara(); flushList(); return; }
      var h = /^(#{1,4})\s+(.*)$/.exec(line);
      var b = /^[-*•]\s+(.*)$/.exec(line);
      var n = /^\d+[.)]\s+(.*)$/.exec(line);
      if (h) { flushPara(); flushList(); var hn = el("h4"); inline(hn, h[2]); into.appendChild(hn); return; }
      if (b || n) {
        flushPara();
        var type = b ? "ul" : "ol";
        if (!list || listType !== type) { list = el(type); listType = type; into.appendChild(list); }
        var li = el("li"); inline(li, (b || n)[1]); list.appendChild(li); return;
      }
      flushList();
      (para = para || []).push(line);
    });
    flushPara();
    // Make the "does NOT answer" caveat stand out: any list item or paragraph that says so.
    Array.prototype.forEach.call(into.querySelectorAll("li, p"), function (n) {
      if (/does not (tell|answer|cover|include|show)|doesn.t (tell|answer|cover)|cannot answer|not answer/i.test(n.textContent)) n.classList.add("limits");
    });
  }

  /* ---------- config, proof ---------- */
  function setNet() {
    var pill = $("netPill");
    pill.classList.toggle("live", !cfg.testnet);
    pill.querySelector("span").textContent = cfg.testnet ? "Sepolia · test" : "Mainnet · live";
    var b = $("modeBanner");
    b.hidden = false;
    b.className = "mode-banner" + (cfg.testnet ? "" : " live");
    b.textContent = cfg.testnet
      ? "Test mode: this runs on Celo Sepolia. No real money moves."
      : "Live: payments are real " + cfg.token + " on Celo mainnet.";
    $("free").hidden = !cfg.freeRunAllowed;
    $("proofNet").textContent = cfg.testnet ? "Sepolia" : "Mainnet";
    $("kToken").textContent = cfg.token + " on Celo";
    $("kTag").textContent = cfg.builderCode || "";
    $("kTag").className = "mono";
    $("kRepo").setAttribute("href", cfg.repoUrl || "#");
    $("lPer").textContent = usd(cfg.limits.perCallUsd);
    $("lTask").textContent = usd(cfg.limits.perTaskUsd);
    $("lDay").textContent = usd(cfg.limits.dailyUsd);
    var w = $("kWallet"); clear(w);
    if (cfg.agentWallet) {
      w.appendChild(el("a", { class: "mono", href: cfg.explorer + "/address/" + cfg.agentWallet, target: "_blank", rel: "noopener", text: short(cfg.agentWallet) }));
      var cp = el("button", { class: "copy", type: "button", text: "copy" });
      cp.addEventListener("click", function () { copyText(cfg.agentWallet, cp); });
      w.appendChild(cp);
    } else w.textContent = "not set";
    if (cfg.agentId) {
      $("kIdRow").hidden = false;
      var idc = $("kId"); clear(idc);
      idc.appendChild(el("a", { href: "https://www.8004scan.io/agents/celo/" + encodeURIComponent(cfg.agentId), target: "_blank", rel: "noopener", text: "Agent #" + cfg.agentId }));
    }
  }
  function copyText(text, btn) {
    var done = function () { var o = btn.textContent; btn.textContent = "copied"; setTimeout(function () { btn.textContent = o; }, 1400); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () {});
    else { var t = el("textarea"); t.value = text; document.body.appendChild(t); t.select(); try { document.execCommand("copy"); done(); } catch (e) {} document.body.removeChild(t); }
  }
  function loadProof() {
    api("/api/proof").then(function (p) {
      $("sReports").textContent = p.paidReports;
      $("sCustomers").textContent = p.customers;
      $("sRepeat").textContent = p.repeatCustomers;
      $("sChain").textContent = p.onChainPayments;
      var ul = $("recent"); clear(ul);
      $("recentEmpty").hidden = p.recent.length > 0;
      p.recent.forEach(function (r) {
        var link = el("a", { class: "mono", href: cfg.explorer + "/tx/" + r.tx, target: "_blank", rel: "noopener", text: short(r.tx) });
        ul.appendChild(el("li", null, el("span", { class: "who", text: (r.direction === "in" ? "Customer paid " : "Paid " + r.provider + " ") + usd(r.usd) }), link));
      });
    }).catch(function () {});
  }

  /* ---------- examples ---------- */
  var EXAMPLES = [
    "Which AI video tools are trending on TikTok this week?",
    "What hooks and formats work best for small AI accounts on TikTok?",
    "Who are the most active ankara tops sellers on Instagram in Lagos?",
    "What content gets the most engagement for fashion sellers on Instagram?"
  ];
  function initAsk() {
    var chips = $("chips");
    EXAMPLES.forEach(function (t) {
      var b = el("button", { type: "button", text: t });
      b.addEventListener("click", function () { $("q").value = t; onInput(); $("q").focus(); });
      chips.appendChild(b);
    });
    $("q").addEventListener("input", onInput);
    $("q").addEventListener("keydown", function (e) { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") $("go").click(); });
    onInput();
  }
  function onInput() {
    var v = $("q").value.trim();
    $("count").textContent = $("q").value.length + " / 500";
    $("go").disabled = v.length < 8;
  }

  /* ---------- plan ---------- */
  function showPlan(p, title, question) {
    plan = p;
    $("planTitle").textContent = title || "Your plan";
    $("planQ").textContent = question || "";
    $("planQ").hidden = !question;
    $("planNote").textContent = p.steps.length + " paid source" + (p.steps.length === 1 ? "" : "s");
    var ul = $("planList"); clear(ul);
    p.steps.forEach(function (s) {
      ul.appendChild(el("li", null, el("span", { class: "tag", text: s.provider }), el("span", { text: s.why }), el("span", { class: "price", text: usd(s.usd) })));
    });
    $("dataUsd").textContent = usd(p.dataUsd);
    $("feeUsd").textContent = usd(p.feeUsd);
    $("totalUsd").textContent = usd(p.customerUsd);
    $("pay").disabled = !p.steps.length;
    $("free").disabled = !p.steps.length;
    if (!p.steps.length) alertMsg("No live paid source matches this question yet. Try rephrasing it, or mention TikTok or Instagram.", "info");
    show("plan");
  }
  var lastQuestion = "";
  function findPlan() {
    var q = $("q").value.trim();
    if (q.length < 8) return;
    lastQuestion = q;
    alertMsg("");
    show("loading");
    api("/api/plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: q }) })
      .then(function (p) { showPlan(p, "Your plan", q); })
      .catch(function (e) { show("ask"); alertMsg("Could not build a plan: " + e.message); });
  }

  /* ---------- run with live progress ---------- */
  function startClock() {
    var t0 = Date.now();
    $("elapsed").textContent = "0s";
    clock = setInterval(function () { $("elapsed").textContent = Math.round((Date.now() - t0) / 1000) + "s"; }, 1000);
  }
  function stopRun() { clearInterval(pollTimer); clearInterval(clock); pollTimer = clock = null; }
  var STATE_TEXT = { pending: "Waiting", paying: "Paying…", settled: "Bought", failed: "Failed, not charged", blocked: "Blocked by safety rules", uncertain: "Checking" };
  function drawProgress(d) {
    var stage = d.stage;
    $("runStage").textContent =
      stage === "queued" ? (addr ? "Approve the payment in your wallet…" : "Starting…") :
      stage === "buying" ? "The agent is buying data from providers." :
      stage === "writing" ? "Writing your report from the data it bought." : "Done.";
    var ol = $("runList"); clear(ol);
    var settled = 0;
    d.steps.forEach(function (s) {
      if (s.state === "settled") settled++;
      var ico = el("span", { class: "ico " + s.state, "aria-hidden": "true", text: s.state === "settled" ? "✓" : (s.state === "failed" || s.state === "blocked" || s.state === "uncertain") ? "!" : "" });
      ol.appendChild(el("li", null, ico, el("span", { text: s.why }), el("span", { class: "state " + s.state, text: STATE_TEXT[s.state] || s.state })));
    });
    var done = d.steps.filter(function (s) { return s.state !== "pending" && s.state !== "paying"; }).length;
    var pct = stage === "writing" ? 92 : stage === "done" ? 100 : stage === "queued" ? 4 : 8 + (done / Math.max(1, d.steps.length)) * 78;
    $("barFill").style.width = pct + "%";
  }
  function poll(planId) {
    var tick = function () { api("/api/progress/" + encodeURIComponent(planId)).then(drawProgress).catch(function () {}); };
    tick();
    pollTimer = setInterval(tick, 1200);
  }
  function runPlan(mode) {
    if (!plan) return;
    if (mode === "pay" && !addr) { alertMsg("Connect your wallet first (top right).", "info"); return; }
    alertMsg("");
    var p = plan;
    show("run");
    drawProgress({ stage: "queued", steps: p.steps.map(function (s) { return { why: s.why, state: "pending" }; }) });
    startClock(); poll(p.id);
    var req = mode === "pay"
      ? window.CP.payFetch(addr, "/api/run/" + encodeURIComponent(p.id), { method: "POST" }).then(function (r) {
          return r.res.json().catch(function () { return {}; }).then(function (d) {
            if (!r.res.ok) { var e = new Error(d.error || ("HTTP " + r.res.status)); e.body = d; throw e; }
            return d;
          });
        })
      : api("/api/approve", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ planId: p.id }) });
    req.then(function (d) { stopRun(); showReport(d); })
      .catch(function (e) {
        stopRun();
        showPlan(p, "Your plan", lastQuestion);
        alertMsg("Not completed: " + e.message + (e.body && e.body.payments ? " Nothing was charged." : ""));
      });
  }

  /* ---------- report ---------- */
  function showReport(d) {
    lastReport = d.report.text;
    renderMarkdown($("repBody"), d.report.text);
    $("repMeta").textContent = "Written by " + d.report.by + " · data cost " + usd(d.spentUsd);
    var r = $("rcpt"); r.setAttribute("href", "/r/" + encodeURIComponent(d.planId));
    var ul = $("repPays"); clear(ul);
    d.payments.forEach(function (p) {
      var link = p.tx ? el("a", { class: "mono", href: cfg.explorer + "/tx/" + p.tx, target: "_blank", rel: "noopener", text: short(p.tx) }) : el("span", { class: "muted small", text: p.note ? "not charged" : "" });
      ul.appendChild(el("li", null, el("span", { text: p.title }), el("span", { class: "st " + p.status, text: usd(p.usd) + " · " + p.status }), link));
    });
    var fc = $("followCard");
    if (d.followUp) {
      fc.hidden = false;
      $("followText").textContent = "Read recent posts from " + d.followUp.steps.length + " of these accounts for " + usd(d.followUp.customerUsd) + " total.";
      $("followBtn").onclick = function () { showPlan({ id: d.followUp.id, steps: d.followUp.steps, dataUsd: d.followUp.totalUsd, feeUsd: cfg.feeUsd, customerUsd: d.followUp.customerUsd }, "Go deeper", lastQuestion); };
    } else fc.hidden = true;
    remember(d.planId);
    show("report");
    loadProof();
  }

  /* ---------- history (this browser only) ---------- */
  var HKEY = "cp_reports";
  function mineList() { try { return JSON.parse(localStorage.getItem(HKEY) || "[]"); } catch (e) { return []; } }
  function remember(id) {
    try {
      var l = mineList().filter(function (x) { return x.id !== id; });
      l.unshift({ id: id, q: lastQuestion.slice(0, 110), at: Date.now() });
      localStorage.setItem(HKEY, JSON.stringify(l.slice(0, 30)));
    } catch (e) {}
    renderMine();
  }
  function renderMine() {
    var l = mineList();
    $("mine").hidden = !l.length;
    var ul = $("mineList"); clear(ul);
    l.forEach(function (x) {
      ul.appendChild(el("li", null, el("span", { text: x.q || "Report" }), el("a", { href: "/r/" + encodeURIComponent(x.id), target: "_blank", rel: "noopener", text: "Receipt" })));
    });
  }

  /* ---------- wire up ---------- */
  function connect() {
    if (!window.CP) { alertMsg("The wallet module did not load. Refresh the page."); return; }
    $("connect").disabled = true;
    window.CP.connect(cfg.chainId).then(function (a) {
      addr = a;
      $("connect").textContent = short(a);
      $("connect").classList.add("btn-ghost");
      alertMsg("");
    }).catch(function (e) { alertMsg(e.message || "Could not connect the wallet."); })
      .then(function () { $("connect").disabled = false; });
  }
  function reset() { plan = null; alertMsg(""); $("q").value = ""; onInput(); show("ask"); window.scrollTo({ top: 0, behavior: "smooth" }); }

  function init() {
    initAsk();
    renderMine();
    $("go").addEventListener("click", findPlan);
    $("connect").addEventListener("click", connect);
    $("pay").addEventListener("click", function () { runPlan("pay"); });
    $("free").addEventListener("click", function () { runPlan("free"); });
    $("cancel").addEventListener("click", reset);
    $("again").addEventListener("click", reset);
    $("copyRep").addEventListener("click", function () { copyText(lastReport, $("copyRep")); });
    api("/api/config").then(function (c) { cfg = c; setNet(); loadProof(); setInterval(loadProof, 20000); })
      .catch(function () { alertMsg("Could not reach the server. Refresh in a moment."); });
  }
  init();
})();
