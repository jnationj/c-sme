/* cPilot front end. Plain JS. All dynamic text goes through textContent (never innerHTML), so
   provider data and AI text cannot inject markup. */
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var cfg = null;
  var plan = null; // the plan currently shown: { id, steps, dataUsd, feeUsd, customerUsd }
  var sourceSelection = null;
  var selectionConfirmation = window.CPilotSelection.createConfirmation();
  var planRequestGeneration = 0;
  var addr = null;
  var lastReport = "";
  var pollTimer = null;
  var clock = null;
  var paying = false; // true from the moment a payment starts until it finishes: blocks double payments

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

  var PROVIDERS = { tikhub: "TikHub", apify: "Apify", mrscraper: "MrScraper" };
  function pname(p) { return PROVIDERS[String(p).toLowerCase()] || p; }
  function selectedSteps() {
    return plan && sourceSelection ? plan.steps.filter(function (step) { return sourceSelection.has(step.capabilityId); }) : [];
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
    var sym = walletSymbol();
    b.textContent = cfg.testnet
      ? "Test mode: this runs on Celo Sepolia. No real money moves."
      : "Live: payments are real " + sym + " on Celo mainnet.";
    $("free").hidden = !cfg.freeRunAllowed;
    $("proofNet").textContent = cfg.testnet ? "Sepolia test network" : "Celo mainnet";
    $("chipPay").textContent = "Pay in " + sym + " on Celo";
    $("docsLink").setAttribute("href", (cfg.repoUrl || "") + "/blob/main/docs/HOW_IT_WORKS.md");
    $("kToken").textContent = sym + " on Celo";
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
  /* ---------- wallet: the controller lives in client.js (window.CP.wallet); this only draws its state ---------- */
  function walletApi() { return window.CP && window.CP.wallet ? window.CP.wallet : null; }
  // The customer-facing symbol (USA₮, not the server's ASCII "USAT"), from the same config the payment guard uses.
  function walletSymbol() {
    var W = walletApi(), st = W ? W.getState() : null;
    return (st && st.symbol) || (cfg && cfg.token) || "";
  }
  function renderWallet() {
    var W = walletApi();
    if (!W) return;
    var selectionState = selectionConfirmation.state();
    var st = W.getState(), rd = W.readiness();
    addr = st.conn === "connected" ? st.address : null;

    var cb = $("connect");
    cb.textContent = st.conn === "connected" ? st.shortAddress : st.conn === "connecting" ? "Connecting…" : "Connect wallet";
    cb.classList.toggle("btn-ghost", st.conn === "connected");
    cb.disabled = st.busy || (!connected && st.config && !st.config.ok);
    cb.setAttribute("aria-label", st.conn === "connected" ? "Wallet connected: " + st.shortAddress + ". Open wallet options." : "Connect wallet");

    var connected = st.conn === "connected";
    $("siTitle").textContent = connected ? "Wallet" : "Connect to pay";
    $("wbDetails").hidden = !connected;
    $("wbStop").hidden = !connected;
    $("wbHelp").hidden = st.conn !== "no-provider";
    if (connected) {
      $("wbAddr").textContent = st.shortAddress;
      $("wbAddr").setAttribute("title", st.address);
      $("wbNet").textContent = st.chain === "ok" ? st.netName : st.chain === "wrong" ? "Another network (chain " + st.chainId + ")" : "Couldn't read your network";
      var b = st.balance;
      $("wbBal").textContent = b.status === "ok" ? st.balanceText + " " + st.symbol : b.status === "unavailable" ? "Not verified" : "Checking…";
    }

    // One message at a time: a wallet notice (cancelled, switched, changed) wins over the standing reason.
    var msg = st.notice ? st.notice.text : (rd.reason || "");
    var kind = st.notice ? st.notice.kind : rd.kind;
    var box = $("wbMsg");
    box.hidden = !msg || (st.conn === "no-provider" && !st.notice);
    box.textContent = msg;
    box.className = "wb-msg small" + (kind === "info" ? " info" : kind === "error" ? " error" : "");

    var sw = $("wbSwitch");
    sw.hidden = rd.action !== "switch";
    sw.textContent = rd.label;
    sw.disabled = st.busy;

    var price = W.priceText(), pl = $("payLine");
    if (price) {
      clear(pl);
      pl.appendChild(document.createTextNode("You will approve a payment of "));
      pl.appendChild(el("b", { text: price }));
      pl.appendChild(document.createTextNode(" on " + (st.netName || "Celo") + (cfg && cfg.testnet ? " (test money)" : "") + ". Your wallet will ask you to sign it."));
      pl.hidden = false;
    } else pl.hidden = true;

    var pay = $("pay");
    pay.textContent = rd.label;
    pay.disabled = paying || selectionState.busy || !selectionState.valid || rd.action === "none" || !selectedSteps().length;
    $("free").disabled = selectionState.busy || !selectionState.valid || !selectedSteps().length;
    if (!rd.needsConfirm) $("balConfirm").hidden = true;
  }
  function authApi() {
    var W = walletApi();
    return W && W.auth ? W.auth : null;
  }
  function renderAuth(state) {
    var auth = authApi();
    if (!auth) return;
    var status = state.status;
    $("siChoose").hidden = status !== "idle" && status !== "unloaded" && status !== "downloading" && status !== "error";
    $("siCodeForm").hidden = status !== "awaiting-code";
    $("siWorking").hidden = status !== "sending-code" && status !== "verifying" && status !== "finishing" && status !== "creating-wallet" && status !== "redirecting" && status !== "loading" && status !== "downloading";
    $("siAccount").hidden = status !== "ready";
    $("siOff").hidden = state.enabled;
    $("siEmailGo").disabled = !state.enabled || status === "downloading";
    $("siError").hidden = !state.error;
    $("siError").textContent = state.error || "";
    $("siRetry").hidden = status !== "error" || !["create", "timeout", "provider", "mismatch", "connect", "cancelled"].includes(state.failure);
    $("siWorkingText").textContent = status === "sending-code" ? "Sending your verification code…" :
      status === "verifying" ? "Checking your code…" :
      status === "creating-wallet" ? "Creating your email wallet…" :
      status === "finishing" ? "Connecting your email wallet…" :
      status === "redirecting" ? "Continuing sign-in…" : "Loading sign-in…";
    $("siCancel").hidden = status === "loading" || status === "downloading" || status === "sending-code" || status === "verifying";
    $("siSentTo").textContent = state.email || "your email address";
    $("siLabel").textContent = state.label || state.email || "Email wallet";
    $("siAddr").textContent = state.address || "";
    $("siSignOut").hidden = status !== "ready";
    $("siNetwork").textContent = cfg && cfg.chainId === 11142220 ? "Celo Sepolia" :
      cfg && cfg.chainId === 42220 ? "Celo Mainnet" : "Celo network";
    $("siUse").hidden = state.active;
    $("siUse").disabled = status !== "ready" || state.active;
    $("siExport").disabled = status !== "ready" || state.exportInProgress || state.modalOpen;
    $("siExportInstruction").hidden = !state.modalOpen && !state.exportInProgress;
  }
  function showSignIn() {
    var dialog = $("signin"), auth = authApi();
    if (!dialog.open) dialog.showModal();
    if (auth) renderAuth(auth.getState());
  }
  function initAuthUI() {
    var auth = authApi();
    if (!auth) return;
    auth.subscribe(renderAuth);
    $("siEmailForm").addEventListener("submit", function (event) {
      event.preventDefault();
      var email = $("siEmail").value.trim();
      if (!email || !$("siEmail").checkValidity()) {
        $("siEmail").focus();
        return;
      }
      $("siError").hidden = true;
      auth.sendEmailCode(email).catch(function () {});
    });
    $("siCodeForm").addEventListener("submit", function (event) {
      event.preventDefault();
      var code = $("siCode").value.trim();
      if (!/^\d{6}$/.test(code)) {
        $("siError").textContent = "Enter the 6-digit code from your email.";
        $("siError").hidden = false;
        $("siCode").focus();
        return;
      }
      $("siError").hidden = true;
      auth.verifyEmailCode(code).then(function () { $("siCode").value = ""; }).catch(function () {});
    });
    $("siWallet").addEventListener("click", function () {
      var W = walletApi();
      if (!W) return;
      W.connect().then(function () { $("signin").close(); })
        .catch(function (error) {
          $("siError").textContent = error && error.message ? error.message : "Could not connect the browser wallet.";
          $("siError").hidden = false;
        });
    });
    $("siCodeBack").addEventListener("click", function () { auth.cancel(); $("siEmail").focus(); });
    $("siCancel").addEventListener("click", function () { auth.cancel(); });
    $("siRetry").addEventListener("click", function () { auth.retryWallet(); });
    $("siUse").addEventListener("click", function () { auth.activate(); });
    $("siSignOut").addEventListener("click", function () {
      auth.logout().catch(function () {
        $("siError").textContent = "Could not sign out. Please try again.";
        $("siError").hidden = false;
      });
    });
    $("siExport").addEventListener("click", function () {
      $("siExportInstruction").hidden = false;
      auth.exportKey().catch(function () {
        $("siError").textContent = "Could not open Privy's key export screen. Please try again.";
        $("siError").hidden = false;
      });
    });
    $("siCopy").addEventListener("click", function () { copyText($("siAddr").textContent, $("siCopy")); });
  }
  function showBalConfirm() {
    $("bcText").textContent = "We couldn't check your " + walletSymbol() + " balance, so we can't tell whether you have enough. If it is too low, the payment will be declined. You will still be asked to approve the payment in your wallet.";
    $("balConfirm").hidden = false;
    $("bcTitle").focus();
  }
  function onPayClick() {
    var W = walletApi();
    if (!W) { alertMsg("The wallet module did not load. Refresh the page."); return; }
    var rd = W.readiness();
    if (rd.action === "connect") { connect(); return; }
    if (rd.action === "switch") { W.switchNetwork(); return; }
    if (rd.action === "help") { $("wbHelp").hidden = false; $("wbHelp").scrollIntoView({ behavior: "smooth", block: "center" }); return; }
    runPlan("pay");
  }
  function initWallet() {
    var W = walletApi();
    if (!W) return;
    W.init({ chainId: cfg.chainId, token: cfg.token, agentWallet: cfg.agentWallet });
    W.subscribe(renderWallet);
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden && W.getState().conn === "connected") W.refreshBalance();
    });
    // Advisory only: a phone clock far from the server's can make a payment authorisation expire early. Never blocks anything.
    try {
      fetch("/health", { method: "HEAD", cache: "no-store" }).then(function (r) {
        var s = W.clockSkewSeconds(r.headers.get("date"), Date.now());
        if (s === null || Math.abs(s) <= 20) return;
        var a = Math.abs(s), c = $("wbClock");
        c.textContent = "Your device clock looks about " + (a >= 90 ? Math.round(a / 60) + " minutes" : a + " seconds") + " off. If a payment fails, check your phone's date and time.";
        c.hidden = false;
      }).catch(function () {});
    } catch (e) {}
  }

  function copyText(text, btn) {
    var done = function () { var o = btn.textContent; btn.textContent = "copied"; setTimeout(function () { btn.textContent = o; }, 1400); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () {});
    else { var t = el("textarea"); t.value = text; document.body.appendChild(t); t.select(); try { document.execCommand("copy"); done(); } catch (e) {} document.body.removeChild(t); }
  }
  function loadProof() {
    api("/api/proof").then(function (p) {
      $("sData").textContent = p.providerPurchases;
      $("sReports").textContent = p.paidReports;
      $("sCustomers").textContent = p.customers;
      $("sRepeat").textContent = p.repeatCustomers;
      var note = $("proofNote");
      if (p.paidReports === 0) {
        note.textContent = (p.providerPurchases ? p.providerPurchases + " data purchases so far were made by the agent" + (cfg.testnet ? " in test mode" : "") + ". " : "") + "No customer has paid for a report yet." + (p.teamTestReports ? " " + p.teamTestReports + " test report" + (p.teamTestReports === 1 ? " was" : "s were") + " paid by the team's own wallets, which are not counted as customers." : "");
      } else {
        note.textContent = p.paidReports + " report" + (p.paidReports === 1 ? "" : "s") + " paid by " + p.customers + " customer" + (p.customers === 1 ? "" : "s") + (cfg.testnet ? " (test mode)" : "") + ".";
      }
      var ul = $("recent"); clear(ul);
      p.recent.forEach(function (r) {
        var link = el("a", { class: "mono", href: cfg.explorer + "/tx/" + r.tx, target: "_blank", rel: "noopener", text: short(r.tx) });
        ul.appendChild(el("li", null, el("span", { class: "who", text: (r.direction === "in" ? "Customer paid " : "Agent bought from " + pname(r.provider) + " ") + usd(r.usd) }), link));
      });
    }).catch(function () {});
  }

  /* ---------- examples ---------- */
  var EXAMPLES = [
    "Find Instagram posts about Ankara fashion and styling.",
    "What hooks and formats work best for small AI content creators on TikTok?",
    "Find popular Instagram hashtags related to fashion.",
    "Which AI video tools are trending on TikTok this week?"
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
  function renderSourceOptions() {
    if (!plan || !sourceSelection) return;
    var selectionState = selectionConfirmation.state();
    var recommended = $("recommendedList"), other = $("otherList");
    clear(recommended);
    clear(other);
    var recommendedCount = 0, otherCount = 0;
    plan.steps.forEach(function (step) {
      var isRecommended = step.recommended !== false;
      if (isRecommended) recommendedCount++;
      else otherCount++;
      var checkbox = el("input", { class: "service-choice", type: "checkbox", "data-service-id": step.capabilityId });
      checkbox.checked = sourceSelection.has(step.capabilityId);
      checkbox.disabled = selectionState.busy;
      checkbox.setAttribute("aria-label", (isRecommended ? "Recommended: " : "Optional: ") + step.title);
      var details = el("span", { class: "source-copy" },
        el("strong", { text: step.title }),
        el("span", { text: step.why }));
      var row = el("li", null, checkbox, el("span", { class: "tag", text: pname(step.provider) }), details, el("span", { class: "price", text: usd(step.usd) }));
      (isRecommended ? recommended : other).appendChild(row);
    });
    $("alternativesTitle").hidden = !otherCount;
    $("planNote").textContent = recommendedCount + " recommended · " + otherCount + " optional";
    $("selectionStatus").textContent = selectionState.busy
      ? "Checking selected services and current Buy catalogue prices…"
      : selectionState.valid
        ? "Prices and availability were checked against the Buy catalogue. Change the selection to update the estimate."
        : selectionState.quote
          ? "Select at least one source before approving."
          : "The selection could not be verified. Change a selection to retry before approving.";
    $("planLimits").hidden = !plan.limitations || !plan.limitations.length;
    var limits = $("planLimits"); clear(limits);
    (plan.limitations || []).forEach(function (limitation) { limits.appendChild(el("li", { text: limitation })); });
  }
  function setPlanQuote(p, confirmed) {
    plan = p;
    var selectedIds = confirmed && Array.isArray(p.selectedServiceIds) ? p.selectedServiceIds : [];
    var selectionSteps = confirmed
      ? p.steps.map(function (step) {
          return Object.assign({}, step, { selected: selectedIds.indexOf(step.capabilityId) >= 0 });
        })
      : p.steps;
    sourceSelection = window.CPilotSelection.create(selectionSteps, (cfg && cfg.feeUsd) || p.feeUsd);
    renderSourceOptions();
    $("dataUsd").textContent = confirmed ? usd(p.dataUsd) : "Checking…";
    $("feeUsd").textContent = confirmed ? usd(p.feeUsd) : "Checking…";
    $("totalUsd").textContent = confirmed ? usd(p.customerUsd) : "Checking…";
    if (walletApi()) {
      if (confirmed && selectedIds.length) {
        // Register only the server-confirmed selection and quote for the payment guard.
        walletApi().setPlan({ id: p.id, customerUsd: p.customerUsd });
      } else {
        walletApi().clearPlan();
      }
    }
    var selectionState = selectionConfirmation.state();
    $("pay").disabled = selectionState.busy || !selectionState.valid || !selectedSteps().length || $("pay").disabled;
    $("free").disabled = selectionState.busy || !selectionState.valid || !selectedSteps().length;
    renderWallet();
  }
  function showPlan(p, title, question) {
    $("planTitle").textContent = title || "Your plan";
    $("planQ").textContent = question || "";
    $("planQ").hidden = !question;
    $("balConfirm").hidden = true;
    selectionConfirmation.invalidate();
    setPlanQuote(p, false);
    if (p.clarification && p.clarification.length) {
      alertMsg(p.clarification.map(function (item) { return item.prompt; }).join(" "), "info");
    } else if (!p.steps.length) {
      alertMsg("No live paid source matches this question yet. Try rephrasing it, or mention TikTok or Instagram.", "info");
    }
    show("plan");
    updateSourceSelection(sourceSelection.ids());
  }
  function updateSourceSelection(serviceIds) {
    if (!plan || !sourceSelection || selectionConfirmation.state().busy) return;
    var planId = plan.id;
    var requestedIds = (serviceIds || sourceSelection.ids()).slice();
    var confirmation = selectionConfirmation.submit(planId, requestedIds, function (selection) {
      return api("/api/selection", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(selection),
      });
    });
    renderSourceOptions();
    if (walletApi()) walletApi().clearPlan();
    renderWallet();
    confirmation.then(function (result) {
      if (result.stale) return;
      if (result.error) {
        renderSourceOptions();
        renderWallet();
        alertMsg("Could not verify this selection against current Buy prices: " + result.error.message);
        return;
      }
      alertMsg("");
      setPlanQuote(result.quote, true);
      renderSourceOptions();
      renderWallet();
    });
  }
  var lastQuestion = "";
  function findPlan() {
    var q = $("q").value.trim();
    if (q.length < 8) return;
    var requestGeneration = ++planRequestGeneration;
    selectionConfirmation.invalidate();
    lastQuestion = q;
    alertMsg("");
    if (walletApi()) walletApi().clearPlan(); // a new question: nothing is approved until its plan is shown
    show("loading");
    api("/api/plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: q }) })
      .then(function (p) {
        if (requestGeneration !== planRequestGeneration) return;
        showPlan(p, "Your plan", q);
      })
      .catch(function (e) {
        if (requestGeneration !== planRequestGeneration) return;
        show("ask");
        alertMsg("Could not build a plan: " + e.message);
      });
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
  function runPlan(mode, confirmed) {
    if (!plan) return;
    var selectionState = selectionConfirmation.state();
    if (!selectionState.valid || selectionState.busy || !selectedSteps().length) {
      alertMsg("Select at least one source and wait for its current Buy price to be verified before approval.");
      return;
    }
    if (mode === "pay") {
      if (paying) return; // a payment is already in progress
      var rd = walletApi() ? walletApi().readiness() : null;
      if (!rd || !rd.canPay) { renderWallet(); return; }
      if (rd.needsConfirm && !confirmed) { showBalConfirm(); return; } // balance not verified: ask first, never assume enough
      paying = true;
      renderWallet();
    }
    alertMsg("");
    var p = plan;
    var chosenSteps = selectedSteps();
    show("run");
    drawProgress({ stage: "queued", steps: chosenSteps.map(function (s) { return { why: s.why, state: "pending" }; }) });
    startClock(); poll(p.id);
    var req = mode === "pay"
      ? window.CP.payFetch(addr, "/api/run/" + encodeURIComponent(p.id), { method: "POST" }).then(function (r) {
          return r.res.json().catch(function () { return {}; }).then(function (d) {
            if (!r.res.ok) { var e = new Error(d.error || ("HTTP " + r.res.status)); e.body = d; e.status = r.res.status; throw e; }
            return d;
          });
        })
      : api("/api/approve", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ planId: p.id, serviceIds: sourceSelection.ids() }) });
    req.then(function (d) { stopRun(); paying = false; showReport(d); afterPayment(mode); })
      .catch(function (e) {
        stopRun();
        paying = false;
        showPlan(p, "Your plan", lastQuestion);
        if (mode === "pay" && walletApi()) {
          // Plain words, never raw HTTP or RPC text. We cannot always tell whether a failed attempt moved money, so we never claim either way.
          var ex = walletApi().explainError(e);
          alertMsg(ex.text, ex.kind === "info" ? "info" : undefined);
        } else alertMsg("Not completed: " + e.message + (e.body && e.body.payments ? " Nothing was charged." : ""));
        afterPayment(mode);
      });
  }
  function afterPayment(mode) { if (mode === "pay" && walletApi()) walletApi().refreshBalance(); }

  /* ---------- report ---------- */
  function numberText(value) {
    return typeof value === "number" && Number.isFinite(value) ? new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value) : "Unavailable";
  }
  function dashboardPanel(title, className) {
    var panel = el("section", { class: "dashboard-panel" + (className ? " " + className : "") });
    panel.appendChild(el("h3", { text: title }));
    return panel;
  }
  function reportTextPanel(title, text, className) {
    if (!text) return null;
    var panel = dashboardPanel(title, className);
    var article = el("article", { class: "report" });
    renderMarkdown(article, text);
    panel.appendChild(article);
    return panel;
  }
  function renderDashboard(dashboard) {
    var root = $("reportDashboard");
    clear(root);
    root.hidden = !dashboard;
    if (!dashboard) return;

    var summary = el("section", { class: "dashboard-summary " + (dashboard.verdict.kind === "limited" ? "limited" : "") });
    summary.appendChild(el("p", { class: "dashboard-eyebrow", text: "Executive answer" }));
    summary.appendChild(el("h3", { text: dashboard.verdict.label }));
    summary.appendChild(el("p", { class: "dashboard-question", text: dashboard.originalQuestion }));
    var answer = el("article", { class: "report dashboard-answer" });
    renderMarkdown(answer, dashboard.executiveAnswer);
    summary.appendChild(answer);
    summary.appendChild(el("p", { class: "muted small", text: dashboard.verdict.detail }));
    root.appendChild(summary);

    var quality = el("section", { class: "dashboard-kpis", "aria-label": "Research quality" });
    [
      { label: "Records summarized", value: numberText(dashboard.quality.recordsAnalyzed), detail: "Up to 60 items per source" },
      { label: "Sources", value: numberText(dashboard.quality.sourceCount), detail: "With available report data" },
    ].forEach(function (item) {
      quality.appendChild(el("div", { class: "dashboard-kpi" }, el("span", { class: "muted small", text: item.label }), el("b", { text: item.value }), el("span", { class: "muted small", text: item.detail })));
    });
    dashboard.sources.forEach(function (source) {
      source.metrics.forEach(function (metric) {
        quality.appendChild(el("div", { class: "dashboard-kpi" },
          el("span", { class: "muted small", text: metric.name + " median · [" + source.ref + "]" }),
          el("b", { text: numberText(metric.median) }),
          el("span", { class: "muted small", text: (metric.max === undefined ? "Highest unavailable" : "Highest " + numberText(metric.max)) + " · n=" + numberText(metric.sampleSize) }),
        ));
      });
    });
    root.appendChild(quality);

    var observed = dashboardPanel("Observed data", "dashboard-observed");
    observed.appendChild(el("p", { class: "muted small", text: "These summaries come from structured records returned by the selected services; missing metrics are not treated as zero." }));
    var hasObservations = false;
    dashboard.sources.forEach(function (source) {
      if (source.hashtags.length) {
        hasObservations = true;
        var hashtagGroup = el("div", { class: "dashboard-chart-group" });
        hashtagGroup.appendChild(el("h4", { text: source.title + " · [" + source.ref + "]" }));
        var max = Math.max.apply(null, source.hashtags.map(function (item) { return item.count; }));
        source.hashtags.forEach(function (item) {
          var row = el("div", { class: "hashtag-row" });
          row.appendChild(el("span", { class: "hashtag-label", text: item.tag }));
          var track = el("span", { class: "hashtag-track", "aria-hidden": "true" });
          var fill = el("span", { class: "hashtag-fill" });
          fill.style.width = (max > 0 ? Math.max(2, Math.min(100, item.count / max * 100)) : 0) + "%";
          track.appendChild(fill);
          row.appendChild(track);
          row.appendChild(el("b", { class: "hashtag-count", text: numberText(item.count) }));
          hashtagGroup.appendChild(row);
        });
        observed.appendChild(hashtagGroup);
      }
      if (source.hooks) {
        hasObservations = true;
        var hookGroup = el("div", { class: "dashboard-chart-group" });
        hookGroup.appendChild(el("h4", { text: "Caption patterns · [" + source.ref + "] · " + numberText(source.hooks.total) + " captions" }));
        [
          ["Numbered promise", source.hooks.numbered],
          ["Question", source.hooks.question],
          ["How-to", source.hooks.howTo],
          ["Warning or mistake", source.hooks.negative],
          ["POV", source.hooks.pov],
          ["Before and after", source.hooks.beforeAfter],
        ].forEach(function (entry) {
          if (!entry[1]) return;
          var row = el("div", { class: "hashtag-row" });
          row.appendChild(el("span", { class: "hashtag-label", text: entry[0] }));
          var track = el("span", { class: "hashtag-track", "aria-hidden": "true" });
          var fill = el("span", { class: "hashtag-fill" });
          fill.style.width = (Math.max(2, Math.min(100, entry[1] / source.hooks.total * 100))) + "%";
          track.appendChild(fill);
          row.appendChild(track);
          row.appendChild(el("b", { class: "hashtag-count", text: numberText(entry[1]) }));
          hookGroup.appendChild(row);
        });
        observed.appendChild(hookGroup);
      }
    });
    var evidenceCount = 0;
    dashboard.sources.forEach(function (source) { evidenceCount += source.topItems.length; });
    if (evidenceCount) {
      hasObservations = true;
      var evidence = el("div", { class: "evidence-grid" });
      dashboard.sources.forEach(function (source) {
        source.topItems.forEach(function (item) {
          var card = el("article", { class: "evidence-card" });
          card.appendChild(el("p", { class: "dashboard-eyebrow", text: "Evidence · [" + source.ref + "]" }));
          card.appendChild(el("p", { text: item.text }));
          if (item.author) card.appendChild(el("p", { class: "muted small", text: "Creator: " + item.author }));
          if (item.metric) card.appendChild(el("p", { class: "evidence-metric", text: numberText(item.metric.value) + " " + item.metric.name }));
          if (item.url && /^(https?:\/\/)/i.test(item.url)) card.appendChild(el("a", { href: item.url, target: "_blank", rel: "noopener noreferrer", text: "Open source record" }));
          evidence.appendChild(card);
        });
      });
      observed.appendChild(evidence);
    }
    if (!hasObservations) observed.appendChild(el("p", { class: "dashboard-empty", text: "There are no hashtag counts, caption patterns, or individual records available to chart for this report." }));
    root.appendChild(observed);

    var interpretations = el("section", { class: "dashboard-narrative" });
    interpretations.appendChild(el("p", { class: "muted small", text: "The following explanation and actions are written from the computed findings; they are interpretations, not additional measurements." }));
    var findings = reportTextPanel("Business interpretation", dashboard.narrative.findings, "dashboard-interpretation");
    var actions = reportTextPanel("Recommended actions", dashboard.narrative.actions, "dashboard-actions");
    var limitations = reportTextPanel("What this research cannot tell you", dashboard.narrative.limitations, "dashboard-limitations");
    if (findings) interpretations.appendChild(findings);
    if (actions) interpretations.appendChild(actions);
    if (limitations) interpretations.appendChild(limitations);
    root.appendChild(interpretations);

    var limitationPanel = dashboardPanel("Data coverage and limitations", "dashboard-limits");
    var limits = el("ul", { class: "dashboard-limit-list" });
    dashboard.limitations.forEach(function (item) { limits.appendChild(el("li", { text: item })); });
    limitationPanel.appendChild(limits);
    root.appendChild(limitationPanel);

    var provenance = dashboardPanel("Sources and research provenance", "dashboard-provenance");
    provenance.appendChild(el("p", { class: "muted small", text: dashboard.provenanceNote }));
    dashboard.sources.forEach(function (source) {
      var item = el("div", { class: "provenance-item" });
      item.appendChild(el("b", { text: "[" + source.ref + "] " + source.title }));
      if (source.provider) item.appendChild(el("span", { text: "Provider: " + source.provider }));
      if (source.serviceId) item.appendChild(el("span", { class: "mono", text: "Service: " + source.serviceId }));
      if (source.purchase) {
        if (source.purchase.amountUsd) item.appendChild(el("span", { text: "Amount: " + usd(source.purchase.amountUsd) + " · " + source.purchase.status }));
        if (source.purchase.retrievedAt) item.appendChild(el("span", { class: "muted small", text: "Retrieved: " + new Date(source.purchase.retrievedAt).toLocaleString() }));
        if (source.purchase.transaction && /^0x[0-9a-f]{64}$/i.test(source.purchase.transaction)) {
          item.appendChild(el("a", { class: "mono", href: cfg.explorer + "/tx/" + source.purchase.transaction, target: "_blank", rel: "noopener", text: short(source.purchase.transaction) }));
        }
      }
      provenance.appendChild(item);
    });
    root.appendChild(provenance);
  }
  function showReport(d) {
    lastReport = d.report.text;
    renderMarkdown($("repBody"), d.report.text);
    renderDashboard(d.report.dashboard);
    $("repMeta").textContent = (d.report.by === "fallback" ? "Computed directly from the data (no AI writer)" : "Written by " + d.report.by + " from computed facts") + " · data cost " + usd(d.spentUsd);
    var r = $("rcpt"); r.setAttribute("href", "/r/" + encodeURIComponent(d.planId)); r.hidden = !d.receipt;
    var ul = $("repPays"); clear(ul);
    d.payments.forEach(function (p) {
      var link = p.tx ? el("a", { class: "mono", href: cfg.explorer + "/tx/" + p.tx, target: "_blank", rel: "noopener", text: short(p.tx) }) : el("span", { class: "muted small", text: p.status === "failed" ? "not charged" : p.status === "uncertain" ? "payment being checked" : "" });
      ul.appendChild(el("li", null, el("span", { text: (p.ref ? p.ref + "  " : "") + p.title }), el("span", { class: "st " + p.status, text: usd(p.usd) + " · " + p.status }), link));
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
    var W = walletApi();
    if (!W) { alertMsg("The wallet module did not load. Refresh the page."); return; }
    alertMsg("");
    if (W.getState().conn === "connected") { showSignIn(); return; }
    var auth = authApi();
    if (auth && auth.enabled()) { showSignIn(); return; }
    walletApi().connect().catch(function (error) { alertMsg(error && error.message ? error.message : "Could not connect your wallet."); });
  }
  function reset() {
    planRequestGeneration++;
    selectionConfirmation.invalidate();
    plan = null;
    sourceSelection = null;
    if (walletApi()) walletApi().clearPlan();
    $("balConfirm").hidden = true;
    alertMsg("");
    $("q").value = "";
    onInput();
    show("ask");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function init() {
    initAsk();
    renderMine();
    $("go").addEventListener("click", findPlan);
    ["recommendedList", "otherList"].forEach(function (id) {
      $(id).addEventListener("change", function (event) {
        var target = event.target;
        if (!target || !target.classList.contains("service-choice") || !plan || !sourceSelection ||
          selectionConfirmation.state().busy) return;
        try {
          sourceSelection.toggle(target.getAttribute("data-service-id"), target.checked);
          updateSourceSelection();
        } catch (e) {
          alertMsg("Could not update the source selection: " + e.message);
        }
      });
    });
    $("connect").addEventListener("click", connect);
    $("siClose").addEventListener("click", function () { $("signin").close(); });
    $("pay").addEventListener("click", onPayClick);
    $("free").addEventListener("click", function () { runPlan("free"); });
    $("wbStop").addEventListener("click", function () { if (walletApi()) walletApi().disconnect(); });
    $("wbSwitch").addEventListener("click", function () { if (walletApi()) walletApi().switchNetwork(); });
    $("wbRefresh").addEventListener("click", function () { if (walletApi()) walletApi().refreshBalance(); });
    $("wbCopy").addEventListener("click", function () { copyText(location.href, $("wbCopy")); });
    $("bcGo").addEventListener("click", function () { $("balConfirm").hidden = true; runPlan("pay", true); });
    $("bcRetry").addEventListener("click", function () { $("balConfirm").hidden = true; if (walletApi()) walletApi().refreshBalance(); });
    $("bcCancel").addEventListener("click", function () { $("balConfirm").hidden = true; });
    $("cancel").addEventListener("click", reset);
    $("again").addEventListener("click", reset);
    $("rerun").addEventListener("click", function () { if (lastQuestion) { $("q").value = lastQuestion; onInput(); findPlan(); } });
    // A receipt link can prefill the question: /?q=...
    try {
      var pre = new URLSearchParams(location.search).get("q");
      if (pre) { $("q").value = pre.slice(0, 500); onInput(); }
    } catch (e) {}
    $("copyRep").addEventListener("click", function () { copyText(lastReport, $("copyRep")); });
    api("/api/config").then(function (c) { cfg = c; initWallet(); initAuthUI(); setNet(); loadProof(); setInterval(loadProof, 20000); })
      .catch(function () { alertMsg("Could not reach the server. Refresh in a moment."); });
  }
  init();
})();
