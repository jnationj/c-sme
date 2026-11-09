// Bridge between the two ways a customer can bring a wallet (an injected wallet such as MetaMask, and Privy email) and celo1's wallet
// controller (wallet.ts). Pure logic: no React, no `window`, no SDK import, so it is unit-tested in Node.
//
// Both sources only supply a wallet's EIP-1193 provider. Everything after that (account and chain tracking, balance, exact-amount
// review, consent, the one payment lock, the x402 payment itself and the payment guard) is the existing code, unchanged.
// There is no second payment path.
//
// ONE ACTIVE WALLET AT A TIME. Each call names its source. A source can only connect, replace or disconnect ITSELF:
//  - a disconnect event from a source that is not the active one is ignored (an injected wallet can never disconnect a Privy wallet,
//    and a Privy sign-out can never disconnect an injected wallet);
//  - choosing a different wallet makes the new source active and "deactivates" the old one.
import type { Eip1193Provider } from "./wallet.js";

const NOT_CONNECTED = 4100; // EIP-1193 "unauthorized"
const UNSUPPORTED = 4200; // EIP-1193 "unsupported method"

/** The only requests cPilot ever makes of a wallet. It never sends a transaction: payment is a signed authorisation. */
export const ALLOWED_METHODS: ReadonlySet<string> = new Set([
  "eth_accounts",
  "eth_requestAccounts",
  "eth_chainId",
  "wallet_switchEthereumChain",
  "wallet_addEthereumChain", // only used to offer Celo when the wallet does not know it yet
  "eth_signTypedData_v4",
]);

const FORWARDED_EVENTS = ["accountsChanged", "chainChanged", "disconnect"] as const;

function rpcError(message: string, code: number): Error & { code: number } {
  return Object.assign(new Error(message), { code });
}

/**
 * A permanent EIP-1193 object that fronts whichever wallet provider is currently active.
 * The wallet controller holds this one object for good, so after a disconnect it can never keep talking to a stale provider:
 * with nothing behind it every request fails (and the payment guard fails closed on that).
 */
export function createProviderFacade() {
  let under: Eip1193Provider | null = null;
  let unhook: (() => void) | null = null;
  const listeners = new Map<string, Set<(...a: any[]) => void>>();

  const emit = (ev: string, ...args: any[]): void => {
    for (const fn of [...(listeners.get(ev) ?? [])]) {
      try {
        fn(...args);
      } catch {
        /* a broken listener must not break the wallet */
      }
    }
  };

  function drop(): void {
    try {
      unhook?.();
    } catch {
      /* ignore */
    }
    unhook = null;
    under = null;
  }

  return {
    async request(args: { method: string; params?: unknown }): Promise<any> {
      const p = under;
      if (!p) throw rpcError("No wallet is connected.", NOT_CONNECTED);
      if (!ALLOWED_METHODS.has(args.method)) throw rpcError("cPilot does not use this wallet method.", UNSUPPORTED);
      return p.request(args);
    },
    on(ev: string, fn: (...a: any[]) => void): void {
      if (!listeners.has(ev)) listeners.set(ev, new Set());
      listeners.get(ev)!.add(fn);
    },
    removeListener(ev: string, fn: (...a: any[]) => void): void {
      listeners.get(ev)?.delete(fn);
    },
    off(ev: string, fn: (...a: any[]) => void): void {
      listeners.get(ev)?.delete(fn);
    },
    /** Starts fronting a connected provider. Replaces and detaches any earlier one. */
    setUnderlying(p: Eip1193Provider): void {
      drop();
      under = p;
      if (typeof p.on === "function") {
        const hooks: Array<[string, (...a: any[]) => void]> = FORWARDED_EVENTS.map((ev) => [ev, (...a: any[]) => emit(ev, ...a)]);
        for (const [ev, fn] of hooks) p.on(ev, fn);
        unhook = () => {
          for (const [ev, fn] of hooks) (p.removeListener ?? p.off)?.call(p, ev, fn);
        };
      }
    },
    /** Stops fronting anything. Every later request fails until a provider is set again. */
    clear(): void {
      drop();
    },
    isActive: (): boolean => under !== null,
  };
}
export type ProviderFacade = ReturnType<typeof createProviderFacade>;

/* ---------- the bridge ---------- */

export type WalletSource = "injected" | "privy";

export interface SourceHandlers {
  /** The customer chose "Disconnect". End this source's session (Privy: sign out. Injected wallets: local disconnect only). */
  disconnect(): void | Promise<void>;
  /** The customer chose a DIFFERENT wallet. Stop using this one, keeping its session where that is safe. */
  deactivate(): void | Promise<void>;
}

/** Optional connection UI handlers. */
export interface InjectedHandlers {
  /** Opens the injected-wallet connection UI. */
  openConnect(): void;
  /** Opens the injected-wallet account UI. */
  openAccount(): void;
  /** Disconnects this injected wallet from the page. */
  disconnect(): void;
}

export interface BridgeState {
  /** loading: the wallet UI has not mounted yet. ready: the connect UI works. error: it could not load. */
  ui: "loading" | "ready" | "error";
  /** A wallet is connected and its provider is behind the facade. */
  connected: boolean;
  /** Which source owns the active wallet. null when nothing is connected. */
  source: WalletSource | null;
  /** Some source is part-way through connecting. */
  connecting: boolean;
  /** The address the source reports (cPilot's own controller re-reads it from the wallet itself). */
  address: string | null;
  /** Name of the connected wallet, for display only. */
  walletName: string | null;
  /** Bumped whenever the active provider or account is replaced, so the controller knows to re-read it. */
  generation: number;
  /** Customer-facing text for ui "error". Never raw SDK text. */
  error: string | null;
}

export const LOAD_ERROR = "The wallet connection couldn't load. Refresh the page and try again.";

export interface BridgeDeps {
  /** The source the customer last used on this device (a tiny flag; no wallet or SDK code is needed to read it). */
  getPreferred(): WalletSource | null;
  setPreferred(s: WalletSource | null): void;
}

export type ConnectResult = "activated" | "updated" | "ignored";

export function createWalletBridge(deps: BridgeDeps = { getPreferred: () => null, setPreferred: () => {} }) {
  const facade = createProviderFacade();
  const sources = new Map<WalletSource, SourceHandlers>();
  let injected: InjectedHandlers | null = null;
  let providerRef: Eip1193Provider | null = null;
  const connecting = new Set<WalletSource>();
  const subs = new Set<(s: BridgeState) => void>();
  let state: BridgeState = { ui: "loading", connected: false, source: null, connecting: false, address: null, walletName: null, generation: 0, error: null };

  function set(patch: Partial<BridgeState>): void {
    state = { ...state, ...patch, connecting: connecting.size > 0 };
    for (const fn of [...subs]) {
      try {
        fn(state);
      } catch {
        /* a broken subscriber must not break the bridge */
      }
    }
  }
  const safe = (fn: (() => void | Promise<void>) | undefined): void => {
    try {
      const r = fn?.();
      if (r && typeof (r as Promise<void>).catch === "function") (r as Promise<void>).catch(() => {});
    } catch {
      /* the facade is already cut off; a failing source cannot keep a wallet alive */
    }
  };
  const setPreferred = (s: WalletSource | null): void => {
    try {
      deps.setPreferred(s);
    } catch {
      /* storage blocked: the choice only lasts for this page */
    }
  };

  return {
    facade,
    getState: () => state,
    activeSource: (): WalletSource | null => state.source,
    subscribe(fn: (s: BridgeState) => void): () => void {
      subs.add(fn);
      try {
        fn(state);
      } catch {
        /* ignore */
      }
      return () => subs.delete(fn);
    },
    /** A source tells the bridge how to disconnect or deactivate it. */
    registerSource(source: WalletSource, handlers: SourceHandlers): void {
      sources.set(source, handlers);
    },
    /** Registers the injected-wallet UI and its lifecycle. */
    setHandlers(h: InjectedHandlers): void {
      injected = h;
      sources.set("injected", { disconnect: () => h.disconnect(), deactivate: () => {} });
      if (state.ui !== "ready") set({ ui: "ready", error: null });
    },
    setUiError(text: string = LOAD_ERROR): void {
      injected = null;
      sources.delete("injected");
      set({ ui: "error", error: text });
    },
    setConnecting(source: WalletSource, v: boolean): void {
      const had = connecting.has(source);
      if (v) connecting.add(source);
      else connecting.delete(source);
      if (had !== v) set({});
    },
    /**
     * A wallet is connected: put its provider behind the facade and make its source the active one.
     * `restored: true` means the SOURCE brought it back by itself (page reload, saved session), not that the customer just chose it:
     * a restored wallet never replaces an active wallet, and is ignored if the customer last used the other source.
     */
    setConnected(source: WalletSource, provider: Eip1193Provider, address: string | null, walletName: string | null, opts: { restored?: boolean } = {}): ConnectResult {
      connecting.delete(source);
      if (state.source === source) {
        const replaced = providerRef !== provider;
        if (replaced) {
          facade.setUnderlying(provider);
          providerRef = provider;
        }
        const bump = replaced || address !== state.address;
        set({ connected: true, address, walletName, generation: bump ? state.generation + 1 : state.generation });
        return "updated";
      }
      if (state.source !== null) {
        if (opts.restored) {
          safe(sources.get(source)?.deactivate);
          set({});
          return "ignored";
        }
        const prev = state.source;
        facade.clear();
        providerRef = null;
        safe(sources.get(prev)?.deactivate);
      } else if (opts.restored) {
        const pref = deps.getPreferred();
        if (pref !== null && pref !== source) {
          safe(sources.get(source)?.deactivate);
          set({});
          return "ignored";
        }
      }
      facade.setUnderlying(provider);
      providerRef = provider;
      setPreferred(source);
      set({ connected: true, source, address, walletName, generation: state.generation + 1 });
      return "activated";
    },
    /** Swaps in a fresh provider for the ACTIVE wallet of this source (for example after a chain switch). Ignored for any other source. */
    refreshProvider(source: WalletSource, provider: Eip1193Provider): boolean {
      if (state.source !== source || providerRef === provider) return false;
      facade.setUnderlying(provider);
      providerRef = provider;
      set({ generation: state.generation + 1 });
      return true;
    },
    /** A source reports that its wallet is gone. Only the ACTIVE source can disconnect the wallet; anyone else is ignored. */
    setDisconnected(source: WalletSource): boolean {
      connecting.delete(source);
      if (state.source !== source) {
        set({});
        return false;
      }
      facade.clear();
      providerRef = null;
      setPreferred(null);
      set({ connected: false, source: null, address: null, walletName: null });
      return true;
    },
    openConnect(): boolean {
      if (!injected) return false;
      injected.openConnect();
      return true;
    },
    openAccount(): boolean {
      if (!injected) return false;
      injected.openAccount();
      return true;
    },
    /** The customer chose "Disconnect". The facade is cut off immediately, then the ACTIVE source is told to end its session. */
    disconnect(): void {
      const active = state.source;
      facade.clear();
      providerRef = null;
      setPreferred(null);
      if (active) {
        safe(sources.get(active)?.disconnect);
        set({ connected: false, source: null, address: null, walletName: null });
      }
    },
  };
}
export type WalletBridge = ReturnType<typeof createWalletBridge>;
