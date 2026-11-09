// Email and Google sign-in as a state machine. Pure logic: no React, no SDK import, no `window`.
// The React glue (auth-app.ts) feeds it what the Privy SDK reports and gives it the few operations it may perform; this file decides
// what the customer sees and when the embedded wallet is handed to the wallet bridge. It is unit-tested in Node with fakes.
//
// What it never does: sign anything, send anything, read a private key, or start a payment. Signing in only makes a wallet available.
//
// WHY THERE IS A WALLET-CREATION STEP: Privy's `createOnLogin` setting applies only to Privy's own login screens. cPilot draws its own
// dialog (the SDK's "whitelabel" login), and Privy documents that automatic wallet creation is not supported there: the app must create
// the embedded wallet itself once the user is authenticated. That one operation, `ops.createWallet`, is Privy's `useCreateWallet`.
//
// STARTUP: the glue attaches its operations from a React effect, a moment AFTER the host's init() returns. `whenOpsReady()` lets init()
// hand back a promise that settles when that has happened (or after a bounded wait), so the first customer action can never find
// "no operations yet". Nothing here waits for it indefinitely.
import type { Eip1193Provider } from "./wallet.js";
import type { AuthCallbacks, AuthFailure, AuthMethod, AuthState } from "./auth-types.js";

/** The only operations the SDK glue grants. Notice what is NOT here: no signing, no sending, no funding, no raw key access. */
export interface AuthOps {
  sendEmailCode(email: string): Promise<void>;
  loginWithEmailCode(code: string): Promise<void>;
  /** Goes to Google. The page navigates away, so this normally never resolves. */
  startGoogle(): Promise<void>;
  logout(): Promise<void>;
  /** Asks Privy to create the signed-in user's embedded Ethereum wallet. Creates a wallet and nothing else. Rejects if Privy cannot. */
  createWallet(): Promise<void>;
  /** Opens Privy's export screen on Privy's own domain. Resolves when the customer closes it. */
  exportWallet(address: string): Promise<void>;
}

export interface EmbeddedWalletView {
  address: string;
  /** Always asks the SDK for the CURRENT provider (a provider obtained earlier is stale after a chain change). */
  getEthereumProvider(): Promise<Eip1193Provider>;
  /** Changes whenever the wallet's chain changes, so the provider is requested again (the SDK does not update an old provider). */
  chainKey: string;
}

export interface Snapshot {
  /** The SDK has finished starting and knows whether a session exists. */
  ready: boolean;
  /** The SDK reported an error while starting (its own `usePrivy().error`). Only the fact is used, never its text. */
  initError?: boolean;
  authenticated: boolean;
  wallet: EmbeddedWalletView | null;
  /** The signed-in user already has an embedded Ethereum wallet on their Privy account (it may not be listed yet). Then none is created. */
  hasEmbeddedWallet: boolean;
  /** Who is signed in, for display only. */
  label: string | null;
}

export interface SessionOptions {
  /** The page was opened by Google sending the customer back (Privy's one-time parameters are in the address). */
  oauthReturn?: boolean;
  /** How long to wait for the embedded wallet to be created and appear after sign-in. */
  walletTimeoutMs?: number;
  /** How long Privy may take to become ready before the customer is told. */
  readyTimeoutMs?: number;
  /** The longest init() waits for the glue's operations to be attached. */
  opsTimeoutMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
  /** Developer diagnostics: which step failed and a short code (never SDK text). Defaults to nothing. */
  log?: (stage: AuthFailure, code: string) => void;
  /** Local-development-only caller may inspect these already-sanitized Google OAuth errors. */
  oauthDiagnostic?: (diagnostic: OAuthDiagnostic) => void;
}

export interface OAuthDiagnostic {
  source: "onError" | "initOAuth";
  name: string | null;
  code: string | null;
  message: string | null;
  cancelled: boolean;
}

export const TEXT = {
  badEmail: "Please enter a valid email address.",
  sendFailed: "We couldn't send the code. Check the address and try again.",
  badCode: "Enter the 6-digit code from your email.",
  wrongCode: "That code didn't work. Check it and try again, or go back and ask for a new one.",
  verifyFailed: "We couldn't verify the code. Please try again or request a new one.",
  googleCancelled: "Google sign-in was cancelled. You can try again whenever you're ready.",
  googleFailed: "Google sign-in didn't complete. Please try again.",
  loginFailed: "Sign-in didn't complete. Please try again.",
  createFailed: "You're signed in, but we couldn't create your wallet. Please try again.",
  walletTimeout: "You're signed in, but your wallet is taking too long to be ready. Please try again.",
  providerFailed: "Your wallet is ready, but we couldn't connect to it. Please try again.",
  connectFailed: "Your wallet is ready, but cPilot couldn't start using it. Please try again.",
  mismatch: "We couldn't confirm your wallet address. Please sign in again.",
  busyWallet: "Your wallet is still being set up. Please wait a moment.",
  cancelledWallet: "Stopped waiting for your wallet. If it was already being created it may still finish. Choose Try again to check.",
  sessionEnded: "Your sign-in has ended. Please sign in again.",
  sdkUnavailable: "Sign-in isn't available right now. Check your connection and refresh the page to try again.",
  sdkSlow: "Sign-in is taking too long to start. Check your connection and refresh the page to try again.",
  exportFailed: "We couldn't open the key export screen. Please try again.",
  notReady: "Sign in first.",
} as const;

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
const CODE_RE = /^\d{6}$/;

const OAUTH_ERROR_CODES = new Set([
  "allowlist_rejected",
  "client_request_timeout",
  "exited_auth_flow",
  "invalid_captcha",
  "invalid_credentials",
  "invalid_data",
  "missing_or_invalid_privy_app_id",
  "oauth_account_suspended",
  "oauth_unexpected",
  "oauth_user_denied",
  "unknown_auth_error",
]);
const OAUTH_ERROR_NAMES = new Set([
  "AbortError",
  "ApiError",
  "Error",
  "OAuthError",
  "PrivyClientError",
  "PrivyConnectorError",
  "PrivyError",
  "TypeError",
]);
const OAUTH_CANCEL_CODES = new Set(["exited_auth_flow", "oauth_user_denied"]);

function ownString(value: unknown, key: string): string | null {
  if (typeof value !== "object" || value === null) return null;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && "value" in descriptor && typeof descriptor.value === "string" ? descriptor.value : null;
  } catch {
    return null;
  }
}

function safeOAuthMessage(value: string | null): string | null {
  if (!value) return null;
  const message = value.trim();
  if (
    !message ||
    message.length > 200 ||
    /(?:\b[a-z][a-z0-9+.-]*:\/\/|www\.|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|\bbearer\b|\b(?:token|secret|key|recovery|authorization|credential|callback|redirect|code|state|nonce)\b)/i.test(message) ||
    /\b[A-Za-z0-9+/_=-]{32,}\b/.test(message) ||
    /\b\d{4,}\b/.test(message) ||
    /[^A-Za-z0-9 .,:;()/'_-]/.test(message)
  ) return null;
  return message.slice(0, 120);
}

function oauthDiagnostic(source: OAuthDiagnostic["source"], error: unknown): OAuthDiagnostic {
  const rawName = ownString(error, "name") ?? (error instanceof Error ? "Error" : null);
  const rawCode = ownString(error, "privyErrorCode") ?? ownString(error, "code") ?? ownString(error, "errorCode");
  const rawMessage = typeof error === "string" ? error : ownString(error, "message");
  const name = rawName && OAUTH_ERROR_NAMES.has(rawName) ? rawName : null;
  const code = rawCode && OAUTH_ERROR_CODES.has(rawCode.toLowerCase()) ? rawCode.toLowerCase() : null;
  const message = safeOAuthMessage(rawMessage);
  const cancellationText = [rawName, rawCode, rawMessage].filter(Boolean).join(" ");
  const cancelled = !!code && OAUTH_CANCEL_CODES.has(code) || /exit|cancel|denied|closed/i.test(cancellationText);
  return { source, name, code, message, cancelled };
}

const sameAddress = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();
/** Keeps only a short, code-like token (for example "embedded_wallet_already_exists"). Anything else, including free text, becomes "unknown". */
const safeCode = (c: unknown): string => (typeof c === "string" && /^[a-z0-9_]{1,64}$/i.test(c) ? c : "unknown");

export function createAuthSession(opts: SessionOptions = {}) {
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));
  const walletTimeoutMs = opts.walletTimeoutMs ?? 25_000;
  const readyTimeoutMs = opts.readyTimeoutMs ?? 20_000;
  const opsTimeoutMs = opts.opsTimeoutMs ?? 10_000;
  const log = opts.log ?? (() => {});
  const reportOAuthDiagnostic = (source: OAuthDiagnostic["source"], error: unknown): OAuthDiagnostic => {
    const diagnostic = oauthDiagnostic(source, error);
    try {
      opts.oauthDiagnostic?.(diagnostic);
    } catch {
      /* diagnostics must never break sign-in */
    }
    return diagnostic;
  };

  let state: AuthState = {
    status: "loading",
    error: null,
    failure: null,
    address: null,
    method: null,
    email: null,
    label: null,
    origin: null,
    active: false,
    exportInProgress: false,
    modalOpen: false,
  };
  const subs = new Set<(s: AuthState) => void>();
  let ops: AuthOps | null = null;
  let opsWaiters: Array<() => void> = [];
  let readyWaiters: Array<() => void> = [];
  let cb: AuthCallbacks | null = null;
  let snap: Snapshot | null = null;

  let wantActive = false; // may the embedded wallet be handed to the bridge right now?
  let sawSession = false; // the first sight of a wallet in this page decides "login" or "restored"
  let loginMethod: AuthMethod | null = opts.oauthReturn ? "google" : null; // set when the customer starts a sign-in in this page
  let emailLoginErrorCode: string | null = null;
  let emitKey = ""; // address + chain of the last wallet handed over, to avoid handing over the same thing twice
  let handingKey = ""; // address + chain of a hand-over that is still in progress (so a repeat report cannot start a second one)
  let seq = 0; // bumped on logout/deactivate/new work so an in-flight provider fetch cannot finish late
  let timer: unknown = null;
  let readyTimer: unknown = null;
  let loggedOut = false;
  // WALLET CREATION IS PROTECTED THREE WAYS.
  //  createRequested: asked at most once per attempt, however many times the SDK repeats the same state.
  //  inflight: true from the moment createWallet() is called until it SETTLES. A timeout, a retry or a cancel never starts a second call
  //            while the first is still pending (a request already sent to Privy cannot be recalled from here).
  //  epoch: bumped only by sign-out. A result that belongs to an earlier sign-in never changes the current one.
  let createRequested = false;
  let inflight = false;
  let epoch = 0;
  let abandoned = false; // stop waiting after a failure, timeout or cancel, until the customer chooses Try again
  let cancelled = false; // the customer stopped waiting: a wallet that shows up later is NOT activated on its own

  function set(patch: Partial<AuthState>): void {
    // A new status clears the previous failure tag unless the same update sets one.
    state = { ...state, ...(patch.status !== undefined && patch.failure === undefined ? { failure: null } : {}), ...patch };
    for (const fn of [...subs]) {
      try {
        fn(state);
      } catch {
        /* a broken subscriber must not break sign-in */
      }
    }
  }
  const stopTimer = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };
  const stopReadyTimer = () => {
    if (readyTimer !== null) clearTimer(readyTimer);
    readyTimer = null;
  };
  const flushOpsWaiters = () => {
    const w = opsWaiters;
    opsWaiters = [];
    for (const f of w) f();
  };
  const flushReadyWaiters = () => {
    const w = readyWaiters;
    readyWaiters = [];
    for (const f of w) f();
  };
  /**
   * Resolves true once Privy reports it is ready, false if it reported a start-up error or never became ready in time (the notice is then
   * already on screen). A sign-in action taken during Privy's start-up waits here instead of calling an SDK that is not ready yet.
   */
  const sdkReady = (): Promise<boolean> => {
    if (snap?.ready) return Promise.resolve(true);
    if (state.failure === "sdk") return Promise.resolve(false);
    return new Promise<boolean>((resolve) => void readyWaiters.push(() => resolve(!!snap?.ready)));
  };
  /** Gives up on a step with a customer-facing message and a failure tag. Nothing is connected. */
  function giveUp(failure: AuthFailure, text: string, code: unknown = ""): void {
    stopTimer();
    wantActive = false;
    abandoned = true;
    seq++;
    emitKey = "";
    handingKey = "";
    set({ status: "error", error: text, failure, address: null, active: false });
    if (failure === "setup") flushOpsWaiters(); // the tools will not start: nobody should keep waiting for them
    if (failure === "sdk" || failure === "setup") flushReadyWaiters(); // Privy will not become ready in time: stop waiting for it
    try {
      log(failure, safeCode(code));
    } catch {
      /* diagnostics must never break sign-in */
    }
  }
  const startTimer = (text: string = TEXT.walletTimeout) => {
    stopTimer();
    timer = setTimer(() => {
      timer = null;
      if (state.status === "finishing" || state.status === "loading" || state.status === "creating-wallet") giveUp("timeout", text);
    }, walletTimeoutMs);
  };

  async function handOver(w: EmbeddedWalletView, restored: boolean): Promise<void> {
    const mine = ++seq;
    handingKey = w.address.toLowerCase() + "|" + w.chainKey;
    let provider: Eip1193Provider;
    let mismatch = false;
    try {
      provider = await w.getEthereumProvider();
      // Never trust the address blindly: the provider itself must report the same account.
      const accs = await provider.request({ method: "eth_accounts" });
      const first = Array.isArray(accs) ? accs[0] : undefined;
      if (typeof first !== "string" || !sameAddress(first, w.address)) {
        mismatch = true;
        throw new Error("mismatch");
      }
    } catch (e) {
      if (mine !== seq) return;
      if (mismatch) giveUp("mismatch", TEXT.mismatch);
      else giveUp("provider", TEXT.providerFailed, (e as { privyErrorCode?: unknown })?.privyErrorCode ?? (e as { code?: unknown })?.code);
      return;
    }
    if (mine !== seq || !wantActive || !cb) return; // signed out, cancelled, or another wallet took over, while we were waiting
    emitKey = w.address.toLowerCase() + "|" + w.chainKey;
    set({ status: "ready", error: null, address: w.address, active: true });
    try {
      cb.onConnected(provider, w.address, { method: state.method, restored });
    } catch {
      // The wallet bridge refused or failed. Make sure nothing stays half-connected.
      try {
        cb.onDisconnected();
      } catch {
        /* ignore */
      }
      giveUp("connect", TEXT.connectFailed);
    }
  }

  /** Asks Privy to create the embedded wallet, at most once while a call is pending. Creates a wallet and nothing else. */
  async function startWalletCreation(): Promise<void> {
    if (createRequested || !ops) return;
    createRequested = true;
    cancelled = false;
    set({ status: "creating-wallet", error: null });
    startTimer();
    if (inflight) return; // an earlier call is still pending: wait for IT. Its settlement drives this attempt; no second call is made.
    inflight = true;
    const myEpoch = epoch;
    let ok = true;
    let code: unknown;
    try {
      await ops.createWallet();
    } catch (e) {
      ok = false;
      code = (e as { privyErrorCode?: unknown })?.privyErrorCode;
    }
    inflight = false;
    settleCreation(myEpoch, ok, code);
  }

  /** The pending createWallet() call has settled. Apply it only if it still belongs to what the customer is looking at. */
  function settleCreation(myEpoch: number, ok: boolean, code: unknown): void {
    if (myEpoch !== epoch) {
      // It belongs to a sign-in that has since ended. If a newer sign-in was only waiting for it to finish, let that one start fresh.
      if (createRequested && state.status === "creating-wallet" && !cancelled) {
        createRequested = false;
        process();
      }
      return;
    }
    if (state.status !== "creating-wallet") return; // already reported through the SDK's callback, timed out, or cancelled: nothing to change
    if (ok) {
      set({ status: "finishing" }); // created: now wait for the SDK to list it (the timer is still running)
      process();
    } else giveUp("create", TEXT.createFailed, code);
  }

  function process(): void {
    if (!snap || !cb) return;
    if (snap.initError && !snap.ready) {
      // Privy itself reported a start-up error (for example it could not reach its servers). Only the fact is used.
      if (state.failure !== "sdk") giveUp("sdk", TEXT.sdkUnavailable, "sdk_init");
      return;
    }
    if (!snap.ready) return;
    stopReadyTimer();
    flushReadyWaiters();
    if (state.failure === "sdk") {
      // Privy recovered (it became ready after all): clear the notice and carry on normally.
      abandoned = false;
      set({ status: "idle", error: null });
    }
    stopTimerIfSettled();
    if (!snap.authenticated) {
      if (state.status === "ready" || (state.status === "finishing" && sawSession)) {
        // the session ended (signed out elsewhere, expired)
        const was = wantActive;
        wantActive = false;
        seq++;
        emitKey = "";
        handingKey = "";
        set({ status: "idle", address: null, active: false, label: null });
        if (was) cb.onDisconnected();
      } else if (state.status === "loading") {
        if (opts.oauthReturn && !loggedOut) {
          set({ status: "finishing", method: "google" });
          startTimer(TEXT.googleFailed); // Privy is still finishing the Google return trip
        } else set({ status: "idle" });
      }
      return;
    }
    // signed in
    // The customer signed out here but the SDK has not finished ending its session: do not hand the wallet over again.
    if (loggedOut) return;
    set({ label: snap.label });
    if (!snap.wallet) {
      if (abandoned) return; // a failure, timeout or cancel was already reported; wait for the customer to choose Try again
      if (!snap.hasEmbeddedWallet && !createRequested) {
        void startWalletCreation(); // signed in but no wallet exists: create it (once)
        return;
      }
      if (state.status !== "finishing" && state.status !== "creating-wallet") set({ status: "finishing", error: null });
      if (timer === null) startTimer();
      return;
    }
    // A wallet is listed. If the customer stopped waiting, it is NOT activated on their behalf: they can choose Try again.
    if (cancelled) return;
    stopTimer();
    abandoned = false;
    const key = snap.wallet.address.toLowerCase() + "|" + snap.wallet.chainKey;
    if (!sawSession) {
      sawSession = true;
      const fresh = loginMethod !== null;
      // The wallet is here: creation (if that is how it arrived) is over, so its own completion must not start a second hand-over.
      set({ origin: fresh ? "login" : "restored", method: state.method ?? loginMethod, address: snap.wallet.address, ...(state.status === "creating-wallet" ? { status: "finishing" as const } : {}) });
      wantActive = true;
      void handOver(snap.wallet, !fresh);
      return;
    }
    if (!state.address) set({ address: snap.wallet.address, status: state.status === "ready" ? "ready" : state.status });
    if (wantActive && key !== emitKey && key !== handingKey) void handOver(snap.wallet, false); // chain or account changed: hand over a fresh provider
  }
  function stopTimerIfSettled() {
    if (snap && snap.authenticated && snap.wallet && !cancelled) stopTimer();
  }

  /** Use the embedded wallet again after another wallet had been selected. Customer-initiated. */
  function activate(): void {
    if (!(state.status === "ready" && snap?.wallet && cb)) return;
    wantActive = true;
    void handOver(snap.wallet, false);
  }

  /** Is the status X right now? (A function, so a check made before an `await` is not assumed to still hold after it.) */
  const isStatus = (x: AuthState["status"]): boolean => state.status === x;

  /** A wallet step is under way (creating it, or waiting for / opening it). A new login must not start on top of it. */
  const walletStepBusy = (): boolean => state.status === "creating-wallet" || state.status === "finishing";

  return {
    getState: () => state,
    reportModalOpen(open: boolean): void {
      if (state.modalOpen !== open) set({ modalOpen: open });
    },
    subscribe(fn: (s: AuthState) => void): () => void {
      subs.add(fn);
      try {
        fn(state);
      } catch {
        /* ignore */
      }
      return () => subs.delete(fn);
    },
    init(callbacks: AuthCallbacks): void {
      cb = callbacks;
      if (!snap?.ready && readyTimer === null) {
        readyTimer = setTimer(() => {
          readyTimer = null;
          if (!snap?.ready && state.status !== "ready") giveUp("sdk", TEXT.sdkSlow, "sdk_slow");
        }, readyTimeoutMs);
      }
      process();
    },
    attachOps(o: AuthOps): void {
      ops = o;
      flushOpsWaiters();
    },
    /**
     * Resolves once the glue's operations are attached, or when the tools can no longer start, or after a bounded wait.
     * It always settles, so nothing depends on it indefinitely.
     */
    whenOpsReady(): Promise<void> {
      if (ops) return Promise.resolve();
      return new Promise<void>((resolve) => {
        let done = false;
        let t: unknown = null;
        const finish = () => {
          if (done) return;
          done = true;
          if (t !== null) clearTimer(t);
          resolve();
        };
        opsWaiters.push(finish);
        t = setTimer(finish, opsTimeoutMs);
      });
    },
    applySnapshot(s: Snapshot): void {
      snap = s;
      process();
    },
    /** The sign-in tools themselves could not start (not configured, or they crashed). Nothing is connected. */
    fail(text: string): void {
      giveUp("setup", text);
    },
    /** The SDK reported a login failure or the customer backed out (for example closing Google's page). */
    reportLoginError(error: unknown): void {
      if (state.status === "verifying") {
        const code = typeof error === "string" ? error : ownString(error, "privyErrorCode") ?? ownString(error, "code");
        emailLoginErrorCode = code && /^[a-z0-9_]{1,64}$/i.test(code) ? code.toLowerCase() : null;
        return;
      }
      if (state.status === "sending-code") return; // that path reports its own error
      if (state.status === "redirecting" || state.status === "finishing" || state.status === "loading") {
        stopTimer();
        const google = state.method === "google" || loginMethod === "google" || !!opts.oauthReturn;
        const diagnostic = google ? reportOAuthDiagnostic("onError", error) : null;
        loginMethod = null;
        set({ status: "idle", error: diagnostic?.cancelled ? TEXT.googleCancelled : google ? TEXT.googleFailed : TEXT.loginFailed, active: false });
      }
    },
    /** Privy reports that creating the wallet failed (the SDK's onError). Only counts while a creation is being waited for. */
    reportCreateError(code: string): void {
      if (state.status === "creating-wallet") giveUp("create", TEXT.createFailed, code);
    },
    /** Privy reports that the wallet was created (the SDK's onSuccess). The wallet is then waited for, not assumed. */
    reportCreateSuccess(): void {
      if (state.status === "creating-wallet") set({ status: "finishing" });
    },

    async sendCode(email: string): Promise<void> {
      const e = email.trim();
      if (!EMAIL_RE.test(e)) return void set({ error: TEXT.badEmail });
      if (state.status === "ready" && snap?.wallet) return activate();
      if (walletStepBusy()) return void set({ error: TEXT.busyWallet }); // never start another login while the wallet is being set up
      if (state.failure === "sdk" && !snap?.ready) return; // Privy did not start: the notice is already showing, do not call it
      if (!ops) return void set({ status: "error", error: TEXT.loginFailed });
      loggedOut = false;
      createRequested = false;
      abandoned = false;
      cancelled = false;
      set({ status: "sending-code", error: null, email: e });
      if (!(await sdkReady())) return; // Privy is still starting: wait (bounded). If it never is, the notice is on screen
      if (!isStatus("sending-code")) return; // the customer backed out while we waited
      try {
        await ops.sendEmailCode(e);
        if (isStatus("sending-code")) set({ status: "awaiting-code", error: null });
      } catch {
        if (isStatus("sending-code")) set({ status: "idle", error: TEXT.sendFailed, email: null });
      }
    },
    async verifyCode(code: string): Promise<void> {
      const c = code.trim();
      if (state.status !== "awaiting-code") return;
      if (!CODE_RE.test(c)) return void set({ error: TEXT.badCode });
      if (!ops) return void set({ status: "error", error: TEXT.loginFailed });
      set({ status: "verifying", error: null });
      emailLoginErrorCode = null;
      loginMethod = "email";
      set({ method: "email" });
      try {
        await ops.loginWithEmailCode(c);
        // The SDK can report "signed in" (and the wallet step can already be under way) before this call returns. Only move on if nothing did.
        if (isStatus("verifying")) {
          set({ status: "finishing", error: null });
          startTimer();
        }
        process();
      } catch (error) {
        const rejectedCode = ownString(error, "privyErrorCode") ?? ownString(error, "code");
        const code = rejectedCode && /^[a-z0-9_]{1,64}$/i.test(rejectedCode) ? rejectedCode.toLowerCase() : emailLoginErrorCode;
        loginMethod = null;
        if (isStatus("verifying")) {
          set({
            status: "awaiting-code",
            error: code === "invalid_credentials" ? TEXT.wrongCode : TEXT.verifyFailed,
            method: null,
          });
        }
      }
    },
    async google(): Promise<void> {
      if (state.status === "ready" && snap?.wallet) return activate();
      if (walletStepBusy()) return void set({ error: TEXT.busyWallet });
      if (state.failure === "sdk" && !snap?.ready) return; // Privy did not start: the notice is already showing, do not call it
      if (!ops) return void set({ status: "error", error: TEXT.loginFailed });
      loggedOut = false;
      createRequested = false;
      abandoned = false;
      cancelled = false;
      loginMethod = "google";
      set({ status: "redirecting", error: null, method: "google" });
      if (!(await sdkReady())) return;
      if (!isStatus("redirecting")) return; // the customer backed out while we waited
      try {
        await ops.startGoogle();
      } catch (error) {
        loginMethod = null;
        if (isStatus("redirecting")) {
          const diagnostic = reportOAuthDiagnostic("initOAuth", error);
          set({ status: "idle", error: diagnostic.cancelled ? TEXT.googleCancelled : TEXT.googleFailed, method: null });
        }
      }
    },
    /**
     * Back out of an unfinished sign-in, or stop WAITING for the wallet. Stopping the wait is local only: a creation request already sent to
     * Privy cannot be recalled, so it may still finish. Its result then changes nothing on screen and a wallet that appears is not
     * activated on its own; the customer can choose Try again (which waits for the same pending request, never sending a second one).
     */
    cancel(): void {
      if (state.status === "loading" || state.status === "ready") return;
      if (state.status === "creating-wallet" || (state.status === "finishing" && snap?.authenticated)) {
        cancelled = true;
        abandoned = true;
        wantActive = false;
        seq++;
        emitKey = "";
        handingKey = "";
        stopTimer();
        set({ status: "idle", error: TEXT.cancelledWallet, failure: "cancelled" });
        return;
      }
      if (state.status === "finishing") {
        // coming back from Google, nothing signed in yet: stop waiting
        loginMethod = null;
        stopTimer();
        set({ status: "idle", error: null });
        return;
      }
      loginMethod = null;
      stopTimer();
      set({ status: snap && snap.authenticated && state.address ? "ready" : "idle", error: null, email: null, method: state.address ? state.method : null });
    },
    /**
     * Try the wallet step again for a customer who is ALREADY signed in. It never starts a login (no Google, no email code): if the
     * sign-in has ended it says so. If a creation call is still pending it waits for that call instead of making another.
     */
    retryWallet(): void {
      if (loggedOut || !snap?.authenticated || !cb) {
        set({ status: "idle", error: TEXT.sessionEnded });
        return;
      }
      if (state.status !== "error" && state.status !== "idle") return; // already working, or already connected
      cancelled = false;
      abandoned = false;
      seq++;
      set({ status: "finishing", error: null });
      if (snap.wallet) {
        // A wallet is listed: open it again. The provider is requested fresh (never reused from the failed attempt).
        wantActive = true;
        if (!sawSession) process();
        else void handOver(snap.wallet, false);
      } else {
        createRequested = false;
        process();
      }
    },
    /** Use the embedded wallet again after another wallet had been selected. Customer-initiated. */
    activate,
    /** Another wallet took over. Keep the Privy session, but stop handing wallets to the bridge. */
    deactivate(): void {
      wantActive = false;
      seq++; // a provider fetch still in flight must not finish and take the wallet back
      emitKey = "";
      handingKey = "";
      if (state.status === "ready") set({ active: false });
    },
    async logout(): Promise<void> {
      wantActive = false;
      loggedOut = true;
      seq++;
      epoch++; // a wallet creation still pending must not report into the next sign-in
      createRequested = false;
      abandoned = false;
      cancelled = false;
      emitKey = "";
      handingKey = "";
      sawSession = false;
      loginMethod = null;
      stopTimer();
      set({ status: "idle", error: null, address: null, email: null, label: null, method: null, origin: null, active: false });
      cb?.onDisconnected(); // the wallet is cut off first, before any network call
      try {
        await ops?.logout();
      } catch {
        /* already signed out, or offline: the local state is cleared either way */
      }
    },
    /** Customer-initiated only. Privy shows the key on its own domain; this code never sees it. */
    async exportKey(): Promise<void> {
      const addr = state.address;
      if (state.status !== "ready" || !addr || !ops) throw new Error(TEXT.notReady);
      set({ exportInProgress: true });
      try {
        await ops.exportWallet(addr);
      } catch {
        throw new Error(TEXT.exportFailed);
      } finally {
        set({ exportInProgress: false });
      }
    },
  };
}
export type AuthSession = ReturnType<typeof createAuthSession>;
