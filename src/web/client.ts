// Browser-side x402 client. Bundled to web/client.js by scripts/build-web.mjs.
// Injected wallets and Privy's email wallet share the same wallet controller and payment guard.
import { x402Client } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { wrapFetchWithPayment, decodePaymentResponseHeader } from "@x402/fetch";
import { createWalletClient, custom } from "viem";
import {
  clockSkewSeconds,
  computeReadiness,
  createWallet,
  explainPaymentError,
  formatTokenAmount,
  readCeloMainnetPortfolio,
  readTokenBalance,
  type Eip1193Provider,
  type WalletInit,
} from "./wallet.js";
import { createWalletBridge, type WalletSource } from "./wallet-bridge.js";
import { AUTH_INIT_FAILED, AUTH_LOAD_FAILED, createAuthLoader } from "./auth-loader.js";
import type { AuthHost, AuthState } from "./auth-types.js";
import { GuardError, buildExpected, createPaymentGuard, createPaymentLock, createPlanRegistry, installGuard, parsePlanRequest } from "./pay-guard.js";

declare global {
  interface Window {
    CP?: unknown;
    CPAuth?: AuthHost;
  }
}
declare const __PRIVY_ENABLED__: boolean;
const AUTH_SRC = "/auth.js";
const AUTH_START_WAIT_MS = 15_000;

function sessionStore(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null; // blocked storage: the wallet falls back to an in-memory flag
  }
}

const SOURCE_KEY = "cp_wallet_source";
function readPreferred(): WalletSource | null {
  try {
    const source = window.localStorage.getItem(SOURCE_KEY);
    return source === "privy" || source === "injected" ? source : null;
  } catch {
    return null;
  }
}
function writePreferred(source: WalletSource | null): void {
  try {
    if (source) window.localStorage.setItem(SOURCE_KEY, source);
    else window.localStorage.removeItem(SOURCE_KEY);
  } catch {
    // The preference only lasts for this page when browser storage is blocked.
  }
}

const bridge = createWalletBridge({ getPreferred: readPreferred, setPreferred: writePreferred });
const wallet = createWallet({
  getProvider: () => bridge.facade as Eip1193Provider,
  readBalance: (owner, net) => readTokenBalance(net, owner),
  readPortfolio: (owner) => readCeloMainnetPortfolio(owner),
  storage: sessionStore(),
});
const plans = createPlanRegistry();
const lock = createPaymentLock();
const authEnabled = typeof __PRIVY_ENABLED__ === "boolean" && __PRIVY_ENABLED__;
const authLoader = createAuthLoader(AUTH_SRC, {
  addScript: (src) =>
    new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      const timer = setTimeout(() => reject(new Error("timeout")), 30_000);
      script.onload = () => {
        clearTimeout(timer);
        resolve();
      };
      script.onerror = () => {
        clearTimeout(timer);
        script.remove();
        reject(new Error("load error"));
      };
      document.head.appendChild(script);
    }),
  getHost: () => window.CPAuth,
});
let authHost: AuthHost | null = null;
let authPending: Promise<AuthHost> | null = null;
let authLoading = false;
let authLoadError: string | null = null;
let serverChainId = 0;

interface AuthView extends Omit<AuthState, "status"> {
  enabled: boolean;
  status: AuthState["status"] | "unloaded" | "downloading";
}
const authSubscribers = new Set<(state: AuthView) => void>();
function authView(): AuthView {
  const state = authHost?.getState();
  const result: AuthView = state
    ? { ...state, enabled: authEnabled }
    : {
        enabled: authEnabled,
        status: authLoading ? "downloading" : "unloaded",
        error: authLoadError,
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
  if (authLoadError) result.error = authLoadError;
  return result;
}
function publishAuth(): void {
  const state = authView();
  for (const subscriber of [...authSubscribers]) {
    try {
      subscriber(state);
    } catch {
      // One UI subscriber must not interrupt wallet authentication.
    }
  }
}

bridge.registerSource("injected", {
  disconnect: () => {
    bridge.setDisconnected("injected");
  },
  deactivate: () => {},
});
bridge.registerSource("privy", {
  disconnect: () => authHost?.logout(),
  deactivate: () => authHost?.deactivate(),
});

function useProvider(source: WalletSource, provider: Eip1193Provider, address: string, restored = false): void {
  const result = bridge.setConnected(source, provider, address, source === "privy" ? "Email wallet" : "Browser wallet", { restored });
  if (result !== "ignored") void wallet.connect();
}

function ensureAuth(): Promise<AuthHost> {
  if (!authEnabled) return Promise.reject(new Error("Email wallet sign-in isn't configured on this site."));
  if (authPending) return authPending;
  authLoading = true;
  authLoadError = null;
  publishAuth();
  let initializing = false;
  authPending = authLoader
    .load()
    .then(async (host) => {
      initializing = true;
      authHost = host;
      const started = host.init({
        chainId: serverChainId,
        onConnected: (provider, address, info) => useProvider("privy", provider, address, info.restored),
        onDisconnected: () => {
          if (bridge.setDisconnected("privy")) wallet.disconnect();
        },
      });
      host.subscribe(publishAuth);
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([Promise.resolve(started), new Promise<void>((resolve) => (timer = setTimeout(resolve, AUTH_START_WAIT_MS)))]);
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
      authLoading = false;
      publishAuth();
      return host;
    })
    .catch((error) => {
      authLoading = false;
      authPending = null;
      authLoadError = initializing ? AUTH_INIT_FAILED : AUTH_LOAD_FAILED;
      publishAuth();
      throw error;
    });
  return authPending;
}
function shouldRestoreAuth(): boolean {
  if (!authEnabled) return false;
  try {
    return readPreferred() === "privy" || /[?&]privy_oauth_(code|state|provider)=/.test(location.search);
  } catch {
    return false;
  }
}

async function connectInjected(): Promise<void> {
  const provider = window.ethereum;
  if (!provider) throw new Error("No browser wallet was found. Install or open MetaMask, or use the email wallet.");
  bridge.setConnecting("injected", true);
  try {
    const accounts = await provider.request({ method: "eth_requestAccounts" });
    const address = Array.isArray(accounts) ? accounts[0] : undefined;
    if (typeof address !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error("The wallet did not return a valid account.");
    useProvider("injected", provider, address);
  } finally {
    bridge.setConnecting("injected", false);
  }
}

bridge.subscribe((state) => {
  if (state.connected) {
    if (wallet.getState().conn !== "connected") void wallet.connect();
  } else if (wallet.getState().conn === "connected") {
    wallet.disconnect();
  }
});
wallet.subscribe((state) => {
  if (state.conn !== "connected" && state.notice && bridge.getState().connected) {
    const source = bridge.activeSource();
    if (source && bridge.setDisconnected(source) && source === "privy") authHost?.deactivate();
  }
});

// Some wallets inject after the page starts.
window.addEventListener("ethereum#initialized", () => wallet.recheck(), { once: true });

/** What app.js uses. Plain strings and booleans, so the ES5-style page code never handles BigInt. */
const walletApi = {
  init(cfg: WalletInit): Promise<void> {
    serverChainId = typeof cfg.chainId === "number" ? cfg.chainId : 0;
    if (shouldRestoreAuth()) void ensureAuth().catch(() => {});
    return wallet.init(cfg);
  },
  getState: () => wallet.getState(),
  subscribe: wallet.subscribe,
  connect: connectInjected,
  source: () => bridge.activeSource(),
  disconnect(): void {
    bridge.disconnect();
    wallet.disconnect();
  },
  switchNetwork: () => wallet.switchNetwork(),
  refreshBalance: () => wallet.refreshBalance(),
  auth: {
    enabled: () => authEnabled,
    getState: authView,
    subscribe(fn: (state: AuthView) => void): () => void {
      authSubscribers.add(fn);
      fn(authView());
      return () => authSubscribers.delete(fn);
    },
    async sendEmailCode(email: string): Promise<void> {
      await (await ensureAuth()).sendCode(email);
    },
    async verifyEmailCode(code: string): Promise<void> {
      await (await ensureAuth()).verifyCode(code);
    },
    cancel: () => authHost?.cancel(),
    retryWallet: () => authHost?.retryWallet(),
    activate: () => authHost?.activate(),
    async logout(): Promise<void> {
      if (authHost) await authHost.logout();
    },
    async exportKey(): Promise<void> {
      await (await ensureAuth()).exportKey();
    },
  },
  /** Called when a plan is shown. Replaces any earlier plan; an invalid plan simply leaves Pay unavailable. */
  setPlan(plan: { id: string; customerUsd: string }): void {
    try {
      plans.set(plan.id, plan.customerUsd);
    } catch {
      /* plans.set already cleared the registration */
    }
  },
  clearPlan: () => plans.clear(),
  readiness: () => computeReadiness(wallet.getState(), plans.peek()?.amount ?? null),
  /** "0.032 USA₮" for the approved plan, or "" if none. */
  priceText(): string {
    const p = plans.peek();
    const st = wallet.getState();
    return p ? formatTokenAmount(p.amount) + (st.symbol ? " " + st.symbol : "") : "";
  },
  explainError: explainPaymentError,
  clockSkewSeconds,
};

/** Kept for existing callers: connect, then ask for a network switch if needed. Returns the account. */
async function connect(chainId: number) {
  await wallet.connect();
  let st = wallet.getState();
  if (st.conn !== "connected" || !st.address) throw new Error(st.notice?.text ?? "Could not connect your wallet.");
  if (st.chainId !== chainId) {
    await wallet.switchNetwork();
    st = wallet.getState();
  }
  return st.address as `0x${string}`;
}

async function payFetch(address: `0x${string}`, url: string, init?: RequestInit) {
  if (!lock.tryAcquire()) throw new GuardError("busy");
  try {
    const provider = wallet.getProvider();
    const st = wallet.getState();
    if (!provider || !st.config || !st.config.ok) throw new GuardError("config");
    const planId = parsePlanRequest(url, init, location.origin);
    const plan = plans.take(planId); // consumed: the plan must be shown again before another payment
    const exp = buildExpected(st.config.net, st.config.agentWallet, plan);
    const guard = createPaymentGuard(exp, address, { provider, connectedAddress: () => wallet.getState().address, origin: location.origin });

    const walletClient = createWalletClient({ account: address, transport: custom(provider) });
    const client = new x402Client();
    installGuard(client, guard, exp);
    registerExactEvmScheme(client, {
      signer: guard.wrapSigner({
        address,
        signTypedData: (m) => walletClient.signTypedData({ ...(m as any), account: address }),
      }),
    });
    const pay = wrapFetchWithPayment(fetch, client);
    const res = await pay(url, init);
    const h = res.headers.get("payment-response") ?? res.headers.get("x-payment-response");
    let settlement: unknown;
    try {
      settlement = h ? decodePaymentResponseHeader(h) : undefined;
    } catch {
      settlement = undefined;
    }
    return { res, settlement };
  } finally {
    lock.release();
  }
}

window.CP = { connect, payFetch, wallet: walletApi };
