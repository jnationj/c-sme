// Browser wallet controller for cPilot (Stage 1). Injected-wallet (EIP-1193) only.
//
// It tracks the connected account and chain, reads the payment-token balance, reacts to wallet events and answers
// "can this customer pay right now?". It never signs anything and never touches the x402 payment itself (see pay-guard.ts).
// No `window` access here: the provider, balance reader and storage are injected, so this file is unit-tested in Node.
//
// Honest limits: an injected wallet cannot be disconnected by a website. `disconnect()` only makes cPilot stop using the
// wallet on this page; it cannot revoke the wallet's own permission for this site.
import { TOKENS, SEPOLIA_USDC, CELO_MAINNET_ID, CELO_SEPOLIA_ID, parseUsd, formatUsd, type Token } from "../chain/tokens.js";

export interface Eip1193Provider {
  request(args: { method: string; params?: unknown }): Promise<any>;
  on?(event: string, listener: (...args: any[]) => void): unknown;
  removeListener?(event: string, listener: (...args: any[]) => void): unknown;
  off?(event: string, listener: (...args: any[]) => void): unknown;
}

/* ---------- networks and tokens (from the bundled src/chain/tokens.ts; never retyped here) ---------- */

export interface NetConfig {
  chainId: number;
  hexChainId: string;
  token: Token;
  /** Symbol shown to customers (USA₮, not the server's ASCII "USAT"). */
  symbol: string;
  /** Network name shown to customers. */
  name: string;
  rpcUrl: string;
  explorer: string;
  testnet: boolean;
}

export const displaySymbol = (symbol: string): string => (symbol === "USAT" ? "USA₮" : symbol);
const hex = (n: number) => "0x" + n.toString(16);

export interface PortfolioAsset {
  id: "CELO" | "USDC" | "USDT" | "USAT";
  symbol: string;
  name: string;
  decimals: number;
  token?: Token;
}

export interface PortfolioBalance extends PortfolioAsset {
  status: "loading" | "ok" | "zero" | "unavailable";
  atomic: bigint | null;
  formatted: string | null;
}

export const CELO_MAINNET_PORTFOLIO: readonly PortfolioAsset[] = [
  { id: "CELO", symbol: "CELO", name: "Celo", decimals: 18 },
  { id: "USDC", symbol: "USDC", name: "USD Coin", decimals: TOKENS.USDC.decimals, token: TOKENS.USDC },
  { id: "USDT", symbol: "USDT", name: "Tether USD", decimals: TOKENS.USDT.decimals, token: TOKENS.USDT },
  { id: "USAT", symbol: "USA₮", name: "Tether America USD", decimals: TOKENS.USAT.decimals, token: TOKENS.USAT },
];

function loadingPortfolio(): PortfolioBalance[] {
  return CELO_MAINNET_PORTFOLIO.map((asset) => ({ ...asset, status: "loading", atomic: null, formatted: null }));
}

const NETS: Record<number, NetConfig> = {
  [CELO_MAINNET_ID]: {
    chainId: CELO_MAINNET_ID,
    hexChainId: hex(CELO_MAINNET_ID),
    token: TOKENS.USAT,
    symbol: displaySymbol(TOKENS.USAT.symbol),
    name: "Celo",
    rpcUrl: "https://forno.celo.org",
    explorer: "https://celoscan.io",
    testnet: false,
  },
  [CELO_SEPOLIA_ID]: {
    chainId: CELO_SEPOLIA_ID,
    hexChainId: hex(CELO_SEPOLIA_ID),
    token: SEPOLIA_USDC,
    symbol: displaySymbol(SEPOLIA_USDC.symbol),
    name: "Celo Sepolia",
    rpcUrl: "https://forno.celo-sepolia.celo-testnet.org",
    explorer: "https://celo-sepolia.blockscout.com",
    testnet: true,
  },
};

export function netConfigFor(chainId: unknown): NetConfig | undefined {
  return typeof chainId === "number" && Number.isInteger(chainId) ? NETS[chainId] : undefined;
}

/* ---------- small exact helpers ---------- */

export const isAddress = (v: unknown): v is string => typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v);
export const shortAddress = (a: string | null): string => (a ? a.slice(0, 6) + "…" + a.slice(-4) : "");

/** Chain ids arrive as hex ("0xa4ec"), decimal strings or numbers depending on the wallet. */
export function parseChainId(v: unknown): number | null {
  if (typeof v === "number") return Number.isInteger(v) && v >= 0 ? v : null;
  if (typeof v !== "string") return null;
  if (/^0x[0-9a-fA-F]+$/.test(v)) return parseInt(v, 16);
  if (/^\d+$/.test(v)) return Number(v);
  return null;
}

/** 32000n -> "0.032", 1000000n -> "1.00", 10000n -> "0.01". Never floats. */
export function formatTokenAmount(atomic: bigint): string {
  return formatUnits(atomic, 6);
}

export function formatUnits(atomic: bigint, decimals: number): string {
  if (atomic < 0n || !Number.isInteger(decimals) || decimals < 0 || decimals > 255) throw new Error("invalid token amount");
  if (decimals === 0) return atomic.toString() + ".00";
  const scale = 10n ** BigInt(decimals);
  const whole = (atomic / scale).toString();
  const fraction = (atomic % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  const displayedFraction = fraction.length < 2 ? fraction.padEnd(2, "0") : fraction;
  return whole + "." + displayedFraction;
}

export { parseUsd };

/** The sign of a wrong device clock: whole seconds the server's Date header is ahead of the device. Advisory only. */
export function clockSkewSeconds(dateHeader: string | null | undefined, nowMs: number): number | null {
  if (!dateHeader) return null;
  const t = Date.parse(dateHeader);
  return Number.isFinite(t) ? Math.round((t - nowMs) / 1000) : null;
}

function errorCode(e: unknown): number | undefined {
  const x = e as { code?: unknown; cause?: { code?: unknown }; error?: { code?: unknown } } | null | undefined;
  for (const c of [x?.code, x?.cause?.code, x?.error?.code]) if (typeof c === "number") return c;
  return undefined;
}
const errorText = (e: unknown): string => (e instanceof Error ? e.message : typeof e === "string" ? e : "");

/* ---------- token balance: balanceOf(owner) on the real token contract, over the public RPC ---------- */

export function balanceOfCalldata(owner: string): string {
  if (!isAddress(owner)) throw new Error("not an address");
  return "0x70a08231" + owner.slice(2).toLowerCase().padStart(64, "0"); // balanceOf(address)
}

/** Reads the token balance as an exact bigint. Throws on any RPC or format problem: the caller must never treat that as zero. */
export async function readTokenBalance(net: NetConfig, owner: string, fetchFn: typeof fetch = fetch, timeoutMs = 8000): Promise<bigint> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchFn(net.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: net.token.address, data: balanceOfCalldata(owner) }, "latest"] }),
      signal: ctl.signal,
    });
    if (!res.ok) throw new Error("rpc http " + res.status);
    const j = (await res.json()) as { result?: unknown; error?: unknown };
    if (j.error) throw new Error("rpc error");
    if (typeof j.result !== "string" || !/^0x[0-9a-fA-F]{1,64}$/.test(j.result)) throw new Error("rpc result not a balance");
    return BigInt(j.result);
  } finally {
    clearTimeout(timer);
  }
}

async function readNativeBalance(net: NetConfig, owner: string, fetchFn: typeof fetch): Promise<bigint> {
  if (!isAddress(owner)) throw new Error("not an address");
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetchFn(net.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [owner, "latest"] }),
      signal: ctl.signal,
    });
    if (!res.ok) throw new Error("rpc http " + res.status);
    const j = (await res.json()) as { result?: unknown; error?: unknown };
    if (j.error) throw new Error("rpc error");
    if (typeof j.result !== "string" || !/^0x[0-9a-fA-F]{1,64}$/.test(j.result)) throw new Error("rpc result not a balance");
    return BigInt(j.result);
  } finally {
    clearTimeout(timer);
  }
}

export async function readCeloMainnetPortfolio(
  owner: string,
  fetchFn: typeof fetch = fetch,
): Promise<PortfolioBalance[]> {
  const net = netConfigFor(CELO_MAINNET_ID);
  if (!net) throw new Error("Celo Mainnet configuration is unavailable");
  return Promise.all(
    CELO_MAINNET_PORTFOLIO.map(async (asset): Promise<PortfolioBalance> => {
      try {
        const atomic = asset.id === "CELO"
          ? await readNativeBalance(net, owner, fetchFn)
          : await readTokenBalance({ ...net, token: asset.token! }, owner, fetchFn);
        return { ...asset, status: atomic === 0n ? "zero" : "ok", atomic, formatted: formatUnits(atomic, asset.decimals) };
      } catch {
        return { ...asset, status: "unavailable", atomic: null, formatted: null };
      }
    }),
  );
}

/* ---------- state ---------- */

export type ConnState = "no-provider" | "disconnected" | "connecting" | "connected";
export type ChainStatus = "unknown" | "ok" | "wrong";
export type Notice = { kind: "info" | "warn" | "error"; text: string } | null;
export type WalletConfig = { ok: true; net: NetConfig; agentWallet: string } | { ok: false; reason: string };

export interface WalletState {
  conn: ConnState;
  address: string | null;
  shortAddress: string;
  chainId: number | null;
  chain: ChainStatus;
  /** idle/loading: not known yet. unavailable: the read failed (this is NOT zero). ok: exact atomic amount. */
  balance: { status: "idle" | "loading" | "unavailable" | "ok"; atomic: bigint | null };
  balanceText: string | null;
  portfolio: PortfolioBalance[];
  /** True while connecting or switching network. */
  busy: boolean;
  config: WalletConfig | null;
  symbol: string;
  netName: string;
  notice: Notice;
}

export interface WalletDeps {
  getProvider(): Eip1193Provider | undefined | null;
  readBalance(owner: string, net: NetConfig): Promise<bigint>;
  readPortfolio?(owner: string): Promise<PortfolioBalance[]>;
  /** sessionStorage-like. Only remembers that the customer chose "Stop using this wallet here" for this tab. */
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
}

export interface WalletInit {
  chainId: unknown;
  token: unknown;
  agentWallet: unknown;
}

const CLEARED_KEY = "cp_wallet_cleared";

export function createWallet(deps: WalletDeps) {
  let provider: Eip1193Provider | null = deps.getProvider() ?? null;
  let seq = 0; // bumped whenever a balance result could become stale
  let portfolioSeq = 0;
  let memCleared = false; // fallback when storage is unavailable
  let attached: { p: Eip1193Provider; on: Array<[string, (...a: any[]) => void]> } | null = null;
  const subs = new Set<(s: WalletState) => void>();

  let state: WalletState = derive({
    conn: provider ? "disconnected" : "no-provider",
    address: null,
    chainId: null,
    chain: "unknown",
    balance: { status: "idle", atomic: null },
    portfolio: loadingPortfolio(),
    busy: false,
    config: null,
    notice: null,
  });

  function derive(s: Omit<WalletState, "shortAddress" | "balanceText" | "symbol" | "netName">): WalletState {
    const net = s.config && s.config.ok ? s.config.net : null;
    return {
      ...s,
      shortAddress: shortAddress(s.address),
      balanceText: s.balance.status === "ok" && s.balance.atomic !== null ? formatTokenAmount(s.balance.atomic) : null,
      symbol: net ? net.symbol : "",
      netName: net ? net.name : "",
    };
  }
  function set(patch: Partial<WalletState>): void {
    state = derive({ ...state, ...patch });
    for (const fn of [...subs]) {
      try {
        fn(state);
      } catch {
        /* a broken subscriber must not break the wallet */
      }
    }
  }

  const readCleared = (): boolean => {
    try {
      const v = deps.storage?.getItem(CLEARED_KEY);
      return v == null ? memCleared : v === "1";
    } catch {
      return memCleared;
    }
  };
  const writeCleared = (v: boolean): void => {
    memCleared = v;
    try {
      if (v) deps.storage?.setItem(CLEARED_KEY, "1");
      else deps.storage?.removeItem(CLEARED_KEY);
    } catch {
      /* storage unavailable: the in-memory flag still applies until reload */
    }
  };

  /* ----- listeners: attached once per provider, removed on local disconnect ----- */
  function detach(): void {
    if (!attached) return;
    const { p, on } = attached;
    for (const [ev, fn] of on) {
      try {
        (p.removeListener ?? p.off)?.call(p, ev, fn);
      } catch {
        /* ignore */
      }
    }
    attached = null;
  }
  function attach(p: Eip1193Provider): void {
    if (attached && attached.p === p) return;
    detach();
    if (typeof p.on !== "function") return; // no events available: the pay-time live checks still protect the payment
    const handlers: Array<[string, (...a: any[]) => void]> = [
      ["accountsChanged", onAccounts],
      ["chainChanged", onChain],
      ["disconnect", onDisconnect],
    ];
    for (const [ev, fn] of handlers) p.on(ev, fn);
    attached = { p, on: handlers };
  }

  function onAccounts(accs: unknown): void {
    if (readCleared()) return;
    const a = Array.isArray(accs) ? accs[0] : undefined;
    if (typeof a === "string" && isAddress(a)) {
      if (state.address && a.toLowerCase() === state.address.toLowerCase()) return;
      const changed = state.address !== null;
      seq++;
      set({
        conn: "connected",
        address: a,
        balance: { status: "idle", atomic: null },
        portfolio: loadingPortfolio(),
        notice: changed ? { kind: "info", text: "Your wallet account changed. cPilot is now using " + shortAddress(a) + "." } : null,
      });
      void refreshBalance();
      void refreshPortfolio();
    } else {
      goDisconnected("Your wallet no longer has an account connected to cPilot. Connect again to continue.");
    }
  }
  function onChain(id: unknown): void {
    if (readCleared()) return;
    setChain(parseChainId(id));
  }
  function onDisconnect(): void {
    if (readCleared()) return;
    goDisconnected("Your wallet lost its connection. Connect again to continue.");
  }
  function goDisconnected(text: string | null): void {
    seq++;
    portfolioSeq++;
    set({
      conn: provider ? "disconnected" : "no-provider",
      address: null,
      balance: { status: "idle", atomic: null },
      portfolio: loadingPortfolio(),
      busy: false,
      notice: text ? { kind: "warn", text } : null,
    });
  }
  function setChain(c: number | null): void {
    const cfg = state.config;
    const chain: ChainStatus = c === null || !cfg || !cfg.ok ? "unknown" : c === cfg.net.chainId ? "ok" : "wrong";
    set({ chainId: c, chain });
  }
  async function readChain(p: Eip1193Provider): Promise<void> {
    try {
      setChain(parseChainId(await p.request({ method: "eth_chainId" })));
    } catch {
      setChain(null);
    }
  }
  function refreshProvider(): Eip1193Provider | null {
    const p = deps.getProvider() ?? null;
    if (p && p !== provider) {
      provider = p;
      if (state.conn === "no-provider") set({ conn: "disconnected" });
    }
    return provider;
  }

  /* ----- public operations ----- */

  /** Validates the server config against the bundled token config, then silently restores an already-authorised account. */
  async function init(cfg: WalletInit): Promise<void> {
    const net = netConfigFor(cfg.chainId);
    let config: WalletConfig;
    if (!net) config = { ok: false, reason: "This page is set to a network cPilot payments don't support. Please contact support." };
    else if (cfg.token !== net.token.symbol)
      config = { ok: false, reason: "Payment settings don't match between this page and the server. Please refresh. If it keeps happening, contact support." };
    else if (!isAddress(cfg.agentWallet)) config = { ok: false, reason: "Payments aren't available right now (no receiving wallet is set)." };
    else config = { ok: true, net, agentWallet: cfg.agentWallet };
    set({ config });
    const p = refreshProvider();
    if (!p || readCleared() || state.conn === "connected") return;
    try {
      const accs = await p.request({ method: "eth_accounts" }); // no popup
      const a = Array.isArray(accs) ? accs[0] : undefined;
      if (typeof a !== "string" || !isAddress(a)) return;
      attach(p);
      set({ conn: "connected", address: a, balance: { status: "idle", atomic: null }, portfolio: loadingPortfolio() });
      await readChain(p);
      await refreshBalance();
      await refreshPortfolio();
    } catch {
      /* stay disconnected */
    }
  }

  async function connect(): Promise<void> {
    if (state.busy) return;
    const p = refreshProvider();
    if (!p) {
      set({ conn: "no-provider", notice: { kind: "warn", text: "No wallet was found in this browser." } });
      return;
    }
    set({ conn: "connecting", busy: true, notice: null });
    let account: string | null = null;
    try {
      const accs = await p.request({ method: "eth_requestAccounts" });
      const a = Array.isArray(accs) ? accs[0] : undefined;
      if (typeof a !== "string" || !isAddress(a)) throw new Error("no account");
      account = a;
    } catch (e) {
      const code = errorCode(e);
      const text =
        code === 4001
          ? "Connection cancelled. You can try again whenever you're ready."
          : code === -32002
            ? "Your wallet already has a request open. Open your wallet and finish it."
            : "Couldn't connect to your wallet. Please try again.";
      set({ conn: "disconnected", busy: false, notice: { kind: code === 4001 ? "info" : "warn", text } });
      return;
    }
    writeCleared(false);
    attach(p);
    seq++;
    set({ conn: "connected", address: account, busy: false, balance: { status: "idle", atomic: null }, portfolio: loadingPortfolio(), notice: null });
    await readChain(p);
    await refreshBalance();
    await refreshPortfolio();
  }

  /** Local only: cPilot stops using this wallet on this page. The wallet's own permission for the site is not revoked. */
  function disconnect(): void {
    detach();
    writeCleared(true);
    seq++;
    portfolioSeq++;
    set({
      conn: provider ? "disconnected" : "no-provider",
      address: null,
      balance: { status: "idle", atomic: null },
      portfolio: loadingPortfolio(),
      busy: false,
      notice: null,
    });
  }

  /** Asks the wallet to switch, then RE-READS the chain. A switch is never assumed to have worked. */
  async function switchNetwork(): Promise<void> {
    const cfg = state.config;
    const p = provider;
    if (!p || !cfg || !cfg.ok || state.busy) return;
    const net = cfg.net;
    set({ busy: true, notice: null });
    try {
      try {
        await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: net.hexChainId }] });
      } catch (e) {
        if (errorCode(e) === 4902 || /unrecognized chain|not been added|unknown chain/i.test(errorText(e))) {
          await p.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: net.hexChainId,
                chainName: net.name,
                nativeCurrency: { name: "CELO", symbol: "CELO", decimals: 18 },
                rpcUrls: [net.rpcUrl],
                blockExplorerUrls: [net.explorer],
              },
            ],
          });
        } else throw e;
      }
      await readChain(p);
      if (state.chain !== "ok") set({ notice: { kind: "warn", text: "Your wallet didn't switch networks. Please change the network in your wallet to " + net.name + "." } });
    } catch (e) {
      await readChain(p);
      set({
        notice:
          errorCode(e) === 4001
            ? { kind: "info", text: "Network switch cancelled." }
            : { kind: "warn", text: "Couldn't switch the network. Please change it in your wallet to " + net.name + "." },
      });
    } finally {
      set({ busy: false });
    }
  }

  /** Reads the balance on the REQUIRED network (public RPC), whatever network the wallet is on. Failure is "unavailable", never zero. */
  async function refreshBalance(): Promise<void> {
    const cfg = state.config;
    const owner = state.address;
    if (!cfg || !cfg.ok || state.conn !== "connected" || !owner) return;
    const mine = ++seq;
    set({ balance: { status: "loading", atomic: null } });
    try {
      const atomic = await deps.readBalance(owner, cfg.net);
      if (mine === seq && owner === state.address) set({ balance: { status: "ok", atomic } });
    } catch {
      if (mine === seq && owner === state.address) set({ balance: { status: "unavailable", atomic: null } });
    }
  }

  async function refreshPortfolio(): Promise<void> {
    const owner = state.address;
    if (state.conn !== "connected" || !owner || !deps.readPortfolio) return;
    const mine = ++portfolioSeq;
    set({ portfolio: loadingPortfolio() });
    try {
      const portfolio = await deps.readPortfolio(owner);
      if (mine === portfolioSeq && owner === state.address) set({ portfolio });
    } catch {
      if (mine === portfolioSeq && owner === state.address) {
        set({ portfolio: CELO_MAINNET_PORTFOLIO.map((asset) => ({ ...asset, status: "unavailable", atomic: null, formatted: null })) });
      }
    }
  }

  function subscribe(fn: (s: WalletState) => void): () => void {
    subs.add(fn);
    try {
      fn(state);
    } catch {
      /* ignore */
    }
    return () => subs.delete(fn);
  }

  return {
    init,
    connect,
    disconnect,
    switchNetwork,
    refreshBalance,
    refreshPortfolio,
    recheck: () => void refreshProvider(),
    getState: () => state,
    getProvider: () => provider,
    subscribe,
    destroy: () => {
      detach();
      subs.clear();
    },
  };
}

export type Wallet = ReturnType<typeof createWallet>;

/* ---------- can the customer pay right now? (pure) ---------- */

export interface Readiness {
  canPay: boolean;
  /** True when the balance couldn't be checked: the customer must explicitly confirm before paying. */
  needsConfirm: boolean;
  action: "none" | "connect" | "switch" | "help" | "pay";
  label: string;
  reason: string;
  kind: "info" | "warn" | "error";
}

export function computeReadiness(s: WalletState, price: bigint | null): Readiness {
  const r = (canPay: boolean, action: Readiness["action"], label: string, reason = "", kind: Readiness["kind"] = "info", needsConfirm = false): Readiness => ({
    canPay,
    needsConfirm,
    action,
    label,
    reason,
    kind,
  });
  const cfg = s.config;
  if (cfg && !cfg.ok) return r(false, "none", "Payments unavailable", cfg.reason, "error");
  if (s.conn === "no-provider")
    return r(false, "help", "Open in your wallet app", "No wallet was found in this browser. Open cPilot inside your wallet app's own browser to pay.", "warn");
  if (s.busy) return r(false, "none", s.conn === "connecting" ? "Connecting…" : "Working…");
  if (s.conn !== "connected") return r(false, "connect", "Connect wallet to pay");
  const net = cfg && cfg.ok ? cfg.net : null;
  if (s.chain === "wrong") return r(false, "switch", "Switch to " + (net?.name ?? "Celo"), "Your wallet is on another network. cPilot payments use " + (net?.name ?? "Celo") + ".", "warn");
  if (s.chain === "unknown") return r(false, "switch", "Switch to " + (net?.name ?? "Celo"), "We couldn't read your wallet's network.", "warn");
  if (price === null) return r(false, "none", "Review your plan first");
  const amount = formatTokenAmount(price) + " " + s.symbol;
  if (s.balance.status === "idle" || s.balance.status === "loading") return r(false, "none", "Checking balance…");
  if (s.balance.status === "ok" && s.balance.atomic !== null) {
    if (s.balance.atomic < price)
      return r(false, "none", "Not enough " + s.symbol, "This report costs " + amount + ". Your balance is " + formatTokenAmount(s.balance.atomic) + " " + s.symbol + ".", "warn");
    return r(true, "pay", "Pay " + amount);
  }
  return r(true, "pay", "Pay " + amount + " (balance not checked)", "We couldn't check your " + s.symbol + " balance right now.", "warn", true);
}

/* ---------- payment errors in plain words (never raw HTTP or RPC text) ---------- */

const GUARD_TEXT: Record<string, string> = {
  account: "Your wallet account changed. Reconnect and review the payment again.",
  chain: "Your wallet is on a different network. Switch to the right network and try again.",
  plan_missing: "Please review the plan again before paying.",
  plan_mismatch: "Please review the plan again before paying.",
  plan_invalid: "Please review the plan again before paying.",
  bad_request: "Please review the plan again before paying.",
  busy: "A payment is already in progress.",
  config: "Payments aren't available right now.",
};
const GUARD_MISMATCH = "The payment details didn't match your approved quote, so nothing was signed. Please refresh the page and try again.";

export function explainPaymentError(e: unknown): { kind: "info" | "warn" | "error"; text: string } {
  const msg = errorText(e);
  const code = errorCode(e);
  const g = /cpilot_guard:([a-z_]+)/.exec(msg);
  if (g) {
    const c = g[1] ?? "";
    return { kind: "warn", text: GUARD_TEXT[c] ?? GUARD_MISMATCH };
  }
  // x402's own spend control refuses a higher amount than the approved price before our hook runs.
  if (/rejected by spendControls/i.test(msg)) return { kind: "warn", text: GUARD_MISMATCH };
  if (code === 4001 || /user rejected|rejected the request|user denied|denied (message|transaction)|request rejected|cancel+ed/i.test(msg))
    return { kind: "info", text: "You cancelled the request in your wallet. Nothing was sent." };
  const x = e as { status?: unknown; body?: { error?: unknown } } | null;
  const status = typeof x?.status === "number" ? x.status : undefined;
  const server = typeof x?.body?.error === "string" ? x.body.error : "";
  if (status === 404)
    return {
      kind: "warn",
      text: "This quote is no longer available. If your wallet shows a payment for this report, do not pay again. Check your payment activity or contact support before trying again.",
    };
  if (status === 402 || /HTTP 402/.test(msg))
    return {
      kind: "warn",
      text: "Your payment wasn't accepted. This can happen if your balance is too low or the payment window expired. Check your wallet's activity before trying again.",
    };
  if ((status === 400 || status === 429 || status === 502 || status === 503) && server) return { kind: "warn", text: server };
  if (e instanceof TypeError || /failed to fetch|network ?error|load failed/i.test(msg))
    return {
      kind: "warn",
      text: "We couldn't reach cPilot. Check your connection. If your wallet already showed a confirmation, check its activity before trying again.",
    };
  return { kind: "error", text: "Something went wrong with the payment. Check your wallet's activity before trying again." };
}
