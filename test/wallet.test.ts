import { describe, expect, it, vi } from "vitest";
import { CELO_MAINNET_ID, TOKENS, SEPOLIA_USDC } from "../src/chain/tokens.js";
import { sellerToken } from "../src/seller/x402.js";
import { createWalletBridge } from "../src/web/wallet-bridge.js";
import {
  CELO_MAINNET_PORTFOLIO,
  balanceOfCalldata,
  clockSkewSeconds,
  computeReadiness,
  createWallet,
  displaySymbol,
  explainPaymentError,
  formatUnits,
  formatTokenAmount,
  isAddress,
  netConfigFor,
  parseChainId,
  readCeloMainnetPortfolio,
  readTokenBalance,
  shortAddress,
  type PortfolioBalance,
  type WalletState,
} from "../src/web/wallet.js";

// A fake EIP-1193 provider: no browser, no wallet, no network.
const A1 = "0x1234567890123456789012345678901234567890";
const A2 = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
const PAY_TO = "0x2222222222222222222222222222222222222222";
const MAINNET = 42220;
const SEPOLIA = 11142220;

type Handler = (params: any) => unknown;
class FakeProvider {
  accounts: string[] = [A1];
  chainId: unknown = "0xa4ec";
  log: string[] = [];
  handlers: Record<string, Handler> = {};
  private ls = new Map<string, Set<(...a: any[]) => void>>();
  on(ev: string, fn: (...a: any[]) => void) {
    if (!this.ls.has(ev)) this.ls.set(ev, new Set());
    this.ls.get(ev)!.add(fn);
  }
  removeListener(ev: string, fn: (...a: any[]) => void) {
    this.ls.get(ev)?.delete(fn);
  }
  count(ev: string) {
    return this.ls.get(ev)?.size ?? 0;
  }
  emit(ev: string, ...args: unknown[]) {
    for (const fn of [...(this.ls.get(ev) ?? [])]) fn(...args);
  }
  async request({ method, params }: { method: string; params?: unknown }) {
    this.log.push(method);
    const h = this.handlers[method];
    if (h) return h(params);
    switch (method) {
      case "eth_requestAccounts":
      case "eth_accounts":
        return this.accounts;
      case "eth_chainId":
        return this.chainId;
      case "wallet_switchEthereumChain":
        this.chainId = (params as any[])[0].chainId;
        return null;
      case "wallet_addEthereumChain":
        this.chainId = (params as any[])[0].chainId;
        return null;
    }
    throw new Error("unexpected " + method);
  }
}
const rpcError = (code: number, message = "wallet error") => Object.assign(new Error(message), { code });
const tick = () => new Promise((r) => setTimeout(r, 0));
const memStorage = () => {
  const m = new Map<string, string>();
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};
const CFG = { chainId: MAINNET, token: "USAT", agentWallet: PAY_TO };

function make(o: {
  provider?: FakeProvider | null;
  balance?: (owner: string) => Promise<bigint>;
  readPortfolio?: (owner: string) => Promise<PortfolioBalance[]>;
  storage?: any;
} = {}) {
  const provider = o.provider === undefined ? new FakeProvider() : o.provider;
  const storage = o.storage === undefined ? memStorage() : o.storage;
  const readBalance = vi.fn(o.balance ?? (async () => 1_250_000n));
  const readPortfolio = vi.fn(o.readPortfolio ?? (async () => []));
  const w = createWallet({ getProvider: () => provider, readBalance, readPortfolio, storage });
  return { w, provider, storage, readBalance, readPortfolio };
}

/** init() with no authorised account (so it does not silently restore), then restore the accounts; optionally connect. */
async function start(w: ReturnType<typeof make>["w"], p: FakeProvider, connect = true) {
  const accounts = p.accounts;
  p.accounts = [];
  await w.init(CFG);
  p.accounts = accounts;
  if (connect) await w.connect();
}

describe("token configuration and exact amounts", () => {
  it("mainnet is USA₮ at the exact token address, 6 decimals, and never the 18-decimal fee adapter", () => {
    const n = netConfigFor(MAINNET)!;
    expect(n.token).toBe(TOKENS.USAT);
    expect(n.token.address).toBe("0xD2ab3C9A02DBBAB236BfEC45D1d755DF4267F771");
    expect(n.token.address.toLowerCase()).not.toBe("0x0357EE22278c922e1D36cFe6b899269b161880C4".toLowerCase());
    expect(n.token.decimals).toBe(6);
    expect(n.symbol).toBe("USA₮");
    expect(n.hexChainId).toBe("0xa4ec");
  });
  it("Sepolia is USDC at the exact token address, 6 decimals", () => {
    const n = netConfigFor(SEPOLIA)!;
    expect(n.token).toBe(SEPOLIA_USDC);
    expect(n.token.address).toBe("0x01C5C0122039549AD1493B8220cABEdD739BC44E");
    expect(n.token.decimals).toBe(6);
    expect(n.symbol).toBe("USDC");
    expect(n.hexChainId).toBe("0xaa044c");
  });
  it("unknown chains have no configuration", () => {
    for (const c of [1, 44787, 0, -1, 1.5, "42220", null, undefined]) expect(netConfigFor(c)).toBeUndefined();
  });
  it("the browser's token choice cannot silently drift from the server's", () => {
    expect(netConfigFor(MAINNET)!.token).toEqual(sellerToken(false));
    expect(netConfigFor(SEPOLIA)!.token).toEqual(sellerToken(true));
    expect(netConfigFor(MAINNET)!.token.symbol).toBe(sellerToken(false).symbol); // what /api/config calls "token"
  });
  it("shows USA₮ for the server's ASCII symbol and leaves others alone", () => {
    expect(displaySymbol("USAT")).toBe("USA₮");
    expect(displaySymbol("USDC")).toBe("USDC");
  });
  it("formats amounts exactly with at least two decimals", () => {
    expect(formatTokenAmount(32000n)).toBe("0.032");
    expect(formatTokenAmount(1_000_000n)).toBe("1.00");
    expect(formatTokenAmount(10_000n)).toBe("0.01");
    expect(formatTokenAmount(0n)).toBe("0.00");
    expect(formatTokenAmount(1n)).toBe("0.000001");
    expect(formatTokenAmount(123_456_789_012n)).toBe("123456.789012");
    expect(formatTokenAmount(1_250_000n)).toBe("1.25");
  });
  it("parses chain ids in hex, decimal and number form", () => {
    expect(parseChainId("0xa4ec")).toBe(42220);
    expect(parseChainId("42220")).toBe(42220);
    expect(parseChainId(42220)).toBe(42220);
    for (const bad of ["", "0x", "abc", null, undefined, 1.5, -1, {}]) expect(parseChainId(bad)).toBeNull();
  });
  it("validates and shortens addresses", () => {
    expect(isAddress(A1)).toBe(true);
    for (const bad of ["0x123", "1234567890123456789012345678901234567890", null, 5]) expect(isAddress(bad)).toBe(false);
    expect(shortAddress(A1)).toBe("0x1234…7890");
    expect(shortAddress(null)).toBe("");
  });
  it("encodes balanceOf(address) for the token contract", () => {
    expect(balanceOfCalldata(A1)).toBe("0x70a08231" + "0".repeat(24) + A1.slice(2).toLowerCase());
    expect(() => balanceOfCalldata("0x12")).toThrow();
  });
  it("measures clock skew from a Date header, advisory only", () => {
    const now = Date.parse("2026-11-06T10:00:00Z");
    expect(clockSkewSeconds("Fri, 06 Nov 2026 10:01:00 GMT", now)).toBe(60);
    expect(clockSkewSeconds("Fri, 06 Nov 2026 09:59:30 GMT", now)).toBe(-30);
    expect(clockSkewSeconds("garbage", now)).toBeNull();
    expect(clockSkewSeconds(null, now)).toBeNull();
  });
});

describe("balance reading (balanceOf on the token contract)", () => {
  const net = netConfigFor(MAINNET)!;
  const okFetch = (result: unknown, init: Partial<{ ok: boolean; status: number; body: unknown }> = {}) =>
    vi.fn(async (_url: unknown, _opts: any) => ({ ok: init.ok ?? true, status: init.status ?? 200, json: async () => init.body ?? { jsonrpc: "2.0", id: 1, result } })) as any;

  it("calls the token contract (not the adapter) on the required network and returns an exact bigint", async () => {
    const f = okFetch("0x" + (1_250_000).toString(16).padStart(64, "0"));
    expect(await readTokenBalance(net, A1, f)).toBe(1_250_000n);
    const [url, opts] = f.mock.calls[0];
    expect(url).toBe("https://forno.celo.org");
    const body = JSON.parse(opts.body);
    expect(body.method).toBe("eth_call");
    expect(body.params[0].to).toBe("0xD2ab3C9A02DBBAB236BfEC45D1d755DF4267F771");
    expect(body.params[0].data).toBe(balanceOfCalldata(A1));
  });
  it("keeps precision beyond 2^53", async () => {
    const big = 9_007_199_254_740_993n; // 2^53 + 1
    expect(await readTokenBalance(net, A1, okFetch("0x" + big.toString(16)))).toBe(big);
  });
  it("throws (never returns zero) on RPC errors, bad HTTP and malformed results", async () => {
    await expect(readTokenBalance(net, A1, okFetch(undefined, { body: { error: { code: -32000 } } }))).rejects.toThrow();
    await expect(readTokenBalance(net, A1, okFetch(undefined, { ok: false, status: 429 }))).rejects.toThrow();
    for (const bad of ["0x", "12", 12, null, "0x" + "f".repeat(65)]) await expect(readTokenBalance(net, A1, okFetch(bad))).rejects.toThrow();
    await expect(readTokenBalance(net, A1, vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))) as any)).rejects.toThrow();
  });
});

describe("Celo Mainnet wallet portfolio", () => {
  const portfolioFetch = (respond: (method: string, to: string | null) => string | { code: number }) =>
    vi.fn(async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      expect(url).toBe("https://forno.celo.org");
      const request = JSON.parse(String(init?.body)) as {
        method: string;
        params: [{ to?: string }, string];
      };
      const answer = respond(request.method, request.params[0].to ?? null);
      return {
        ok: true,
        status: 200,
        json: async () => typeof answer === "string" ? { result: answer } : { error: answer },
      } as Response;
    });

  it("uses the four mainnet entries and preserves distinct USDC, USDT and USA₮ identities", () => {
    expect(CELO_MAINNET_PORTFOLIO.map(({ id, symbol, decimals }) => ({ id, symbol, decimals }))).toEqual([
      { id: "CELO", symbol: "CELO", decimals: 18 },
      { id: "USDC", symbol: "USDC", decimals: 6 },
      { id: "USDT", symbol: "USDT", decimals: 6 },
      { id: "USAT", symbol: "USA₮", decimals: 6 },
    ]);
    expect(CELO_MAINNET_PORTFOLIO.slice(1).map((asset) => asset.token?.address)).toEqual([
      "0xcebA9300f2b948710d2653dD7B07f33A8B32118C",
      "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e",
      "0xD2ab3C9A02DBBAB236BfEC45D1d755DF4267F771",
    ]);
    expect(CELO_MAINNET_PORTFOLIO.slice(1).map((asset) => asset.token?.decimals)).toEqual([6, 6, 6]);
    expect(CELO_MAINNET_PORTFOLIO.map(({ name }) => name)).toEqual(["Celo", "USD Coin", "Tether USD", "Tether America USD"]);
    expect(netConfigFor(CELO_MAINNET_ID)?.rpcUrl).toBe("https://forno.celo.org");
  });

  it("reads native CELO with eth_getBalance and each stablecoin with balanceOf on the mainnet RPC", async () => {
    const fetchFn = portfolioFetch((method, to) => method === "eth_getBalance"
      ? "0x" + (1_500_000_000_000_000_000n).toString(16)
      : to === TOKENS.USDC.address
        ? "0x" + (2_500_000n).toString(16)
        : to === TOKENS.USDT.address
          ? "0x" + (3_500_000n).toString(16)
          : to === TOKENS.USAT.address
            ? "0x" + (4_500_000n).toString(16)
            : { code: -1 });
    const balances = await readCeloMainnetPortfolio(A1, fetchFn as unknown as typeof fetch);
    expect(balances.map(({ status, formatted }) => [status, formatted])).toEqual([
      ["ok", "1.50"],
      ["ok", "2.50"],
      ["ok", "3.50"],
      ["ok", "4.50"],
    ]);
    const requests = fetchFn.mock.calls.map(([, init]) => JSON.parse(String(init?.body)));
    expect(requests.find((r) => r.method === "eth_getBalance").params).toEqual([A1, "latest"]);
    expect(requests.filter((r) => r.method === "eth_call").map((r) => r.params[0].to)).toEqual([
      TOKENS.USDC.address,
      TOKENS.USDT.address,
      TOKENS.USAT.address,
    ]);
  });

  it("shows a real zero and keeps other assets available when one token RPC call fails", async () => {
    const fetchFn = portfolioFetch((method, to) => {
      if (method === "eth_call" && to === TOKENS.USDT.address) return { code: -32000 };
      return "0x0";
    });
    const balances = await readCeloMainnetPortfolio(A1, fetchFn as unknown as typeof fetch);
    expect(balances.map(({ status, formatted }) => [status, formatted])).toEqual([
      ["zero", "0.00"],
      ["zero", "0.00"],
      ["unavailable", null],
      ["zero", "0.00"],
    ]);
  });

  it("formats native 18-decimal values without floating-point conversion", () => {
    expect(formatUnits(1n, 18)).toBe("0.000000000000000001");
    expect(formatUnits(1_234_567_890_123_456_789n, 18)).toBe("1.234567890123456789");
  });
});

describe("configuration consistency", () => {
  it("accepts a matching server config", async () => {
    const { w } = make();
    await w.init(CFG);
    const c = w.getState().config!;
    expect(c.ok).toBe(true);
    expect(w.getState().symbol).toBe("USA₮");
    expect(w.getState().netName).toBe("Celo");
  });
  it("accepts Sepolia with USDC", async () => {
    const { w } = make();
    await w.init({ chainId: SEPOLIA, token: "USDC", agentWallet: PAY_TO });
    expect(w.getState().config?.ok).toBe(true);
    expect(w.getState().symbol).toBe("USDC");
  });
  const bad: Array<[string, any]> = [
    ["a token symbol that does not match the chain", { ...CFG, token: "USDC" }],
    ["mainnet with the Sepolia token", { chainId: MAINNET, token: "USDC", agentWallet: PAY_TO }],
    ["an unsupported chain", { ...CFG, chainId: 1 }],
    ["a missing receiving wallet", { ...CFG, agentWallet: null }],
    ["a malformed receiving wallet", { ...CFG, agentWallet: "0x12" }],
  ];
  for (const [name, cfg] of bad) {
    it(`disables payments for ${name}`, async () => {
      const { w } = make();
      await w.init(cfg);
      expect(w.getState().config?.ok).toBe(false);
      const r = computeReadiness(w.getState(), 32000n);
      expect(r.canPay).toBe(false);
      expect(r.label).toBe("Payments unavailable");
    });
  }
});

describe("wallet controller", () => {
  it("reports an unavailable provider and keeps working once one appears", async () => {
    let injected: FakeProvider | null = null;
    const w = createWallet({ getProvider: () => injected, readBalance: async () => 5n, storage: memStorage() });
    await w.init(CFG);
    expect(w.getState().conn).toBe("no-provider");
    await w.connect();
    expect(w.getState().conn).toBe("no-provider");
    expect(w.getState().notice?.kind).toBe("warn");
    injected = new FakeProvider(); // a wallet that injects late
    await w.connect();
    expect(w.getState().conn).toBe("connected");
  });

  it("connects, reads the chain, loads the balance and attaches each listener once", async () => {
    const { w, provider, readBalance } = make();
    await w.init(CFG);
    await w.connect();
    const s = w.getState();
    expect(s.conn).toBe("connected");
    expect(s.address).toBe(A1);
    expect(s.shortAddress).toBe("0x1234…7890");
    expect(s.chain).toBe("ok");
    expect(s.balance).toEqual({ status: "ok", atomic: 1_250_000n });
    expect(s.balanceText).toBe("1.25");
    expect(readBalance).toHaveBeenCalledWith(A1, netConfigFor(MAINNET));
    for (const ev of ["accountsChanged", "chainChanged", "disconnect"]) expect(provider!.count(ev)).toBe(1);
    await w.connect(); // connecting again must not duplicate listeners
    for (const ev of ["accountsChanged", "chainChanged", "disconnect"]) expect(provider!.count(ev)).toBe(1);
  });

  it("handles a rejected connection without crashing", async () => {
    const { w, provider } = make();
    provider!.handlers.eth_requestAccounts = () => {
      throw rpcError(4001, "User rejected the request.");
    };
    await start(w, provider!, false);
    await w.connect();
    const s = w.getState();
    expect(s.conn).toBe("disconnected");
    expect(s.busy).toBe(false);
    expect(s.notice).toEqual({ kind: "info", text: expect.stringMatching(/cancelled/i) });
    expect(provider!.count("accountsChanged")).toBe(0);
  });
  it("explains a request that is already open in the wallet, and other failures", async () => {
    const a = make();
    a.provider!.handlers.eth_requestAccounts = () => {
      throw rpcError(-32002);
    };
    await a.w.connect();
    expect(a.w.getState().notice?.text).toMatch(/already has a request open/i);
    const b = make();
    b.provider!.handlers.eth_requestAccounts = () => {
      throw new Error("boom");
    };
    await b.w.connect();
    expect(b.w.getState().notice?.text).toMatch(/couldn't connect/i);
    expect(b.w.getState().conn).toBe("disconnected");
  });
  it("treats an empty account list as a failed connection", async () => {
    const { w, provider } = make();
    provider!.accounts = [];
    await w.connect();
    expect(w.getState().conn).toBe("disconnected");
  });

  it("follows an account change and refetches the balance", async () => {
    const { w, provider, readBalance, readPortfolio } = make({
      balance: async (o) => (o === A1 ? 1_000_000n : 2_000_000n),
      readPortfolio: async (owner) => CELO_MAINNET_PORTFOLIO.map((asset) => ({
        ...asset,
        status: "ok",
        atomic: owner === A1 ? 1n : 2n,
        formatted: owner === A1 ? "1.00" : "2.00",
      })),
    });
    await start(w, provider!);
    expect(readBalance).toHaveBeenCalledTimes(1);
    expect(readPortfolio).toHaveBeenCalledWith(A1);
    provider!.emit("accountsChanged", [A2]);
    await tick();
    const s = w.getState();
    expect(s.address).toBe(A2);
    expect(s.notice?.text).toMatch(/account changed/i);
    expect(s.balance).toEqual({ status: "ok", atomic: 2_000_000n });
    expect(s.portfolio[0]).toMatchObject({ status: "ok", atomic: 2n, formatted: "2.00" });
    expect(readBalance).toHaveBeenCalledTimes(2);
    expect(readPortfolio).toHaveBeenCalledTimes(2);
    expect(readPortfolio).toHaveBeenLastCalledWith(A2);
  });

  it("discards late portfolio results after the active account changes", async () => {
    let releaseOld!: (value: PortfolioBalance[]) => void;
    const oldPortfolio = new Promise<PortfolioBalance[]>((resolve) => (releaseOld = resolve));
    const latest = (value: bigint) => CELO_MAINNET_PORTFOLIO.map((asset) => ({
      ...asset,
      status: "ok" as const,
      atomic: value,
      formatted: value.toString(),
    }));
    const { w, provider } = make({
      readPortfolio: (owner) => owner === A1 ? oldPortfolio : Promise.resolve(latest(2n)),
    });
    await start(w, provider!, false);
    const connecting = w.connect();
    await tick();
    provider!.emit("accountsChanged", [A2]);
    await tick();
    releaseOld(latest(1n));
    await connecting;
    expect(w.getState().address).toBe(A2);
    expect(w.getState().portfolio[0]).toMatchObject({ status: "ok", atomic: 2n, formatted: "2" });
  });

  it("discards late portfolio results after switching the active wallet source", async () => {
    let releaseOld!: (value: PortfolioBalance[]) => void;
    const oldPortfolio = new Promise<PortfolioBalance[]>((resolve) => (releaseOld = resolve));
    const latest = CELO_MAINNET_PORTFOLIO.map((asset) => ({
      ...asset,
      status: "ok" as const,
      atomic: 2n,
      formatted: "2.00",
    }));
    const bridge = createWalletBridge();
    const oldProvider = new FakeProvider();
    const newProvider = new FakeProvider();
    newProvider.accounts = [A2];
    const readPortfolio = vi.fn((owner: string) => owner === A1 ? oldPortfolio : Promise.resolve(latest));
    const wallet = createWallet({
      getProvider: () => bridge.facade,
      readBalance: async () => 0n,
      readPortfolio,
      storage: memStorage(),
    });
    await wallet.init(CFG);
    bridge.setConnected("privy", oldProvider, A1, "Email wallet");
    const oldConnect = wallet.connect();
    await tick();
    bridge.setConnected("injected", newProvider, A2, "Browser wallet");
    await wallet.connect();
    releaseOld(CELO_MAINNET_PORTFOLIO.map((asset) => ({
      ...asset,
      status: "ok",
      atomic: 1n,
      formatted: "1.00",
    })));
    await oldConnect;
    expect(wallet.getState().address).toBe(A2);
    expect(wallet.getState().portfolio[0]).toMatchObject({ status: "ok", atomic: 2n, formatted: "2.00" });
  });

  it("uses the same portfolio reader for injected and Privy active providers", async () => {
    for (const source of ["injected", "privy"] as const) {
      const bridge = createWalletBridge();
      const provider = new FakeProvider();
      const readPortfolio = vi.fn(async () => CELO_MAINNET_PORTFOLIO.map((asset) => ({
        ...asset,
        status: "ok" as const,
        atomic: 0n,
        formatted: "0.00",
      })));
      const wallet = createWallet({
        getProvider: () => bridge.facade,
        readBalance: async () => 0n,
        readPortfolio,
        storage: memStorage(),
      });
      await wallet.init(CFG);
      bridge.setConnected(source, provider, A1, source === "privy" ? "Email wallet" : "Browser wallet");
      await wallet.connect();
      expect(readPortfolio).toHaveBeenCalledWith(A1);
      expect(wallet.getState().portfolio.map((asset) => asset.id)).toEqual(["CELO", "USDC", "USDT", "USAT"]);
      bridge.disconnect();
    }
  });
  it("ignores a repeated account event for the same account", async () => {
    const { w, provider, readBalance } = make();
    await start(w, provider!);
    expect(readBalance).toHaveBeenCalledTimes(1);
    provider!.emit("accountsChanged", [A1.toUpperCase().replace("0X", "0x")]);
    await tick();
    expect(readBalance).toHaveBeenCalledTimes(1);
  });
  it("discards a balance that arrives for an account that is no longer selected", async () => {
    let release!: (v: bigint) => void;
    const slow = new Promise<bigint>((r) => (release = r));
    const { w, provider } = make({ balance: (o) => (o === A1 ? slow : Promise.resolve(7_000_000n)) });
    await start(w, provider!, false);
    const connecting = w.connect(); // A1's balance is pending
    await tick();
    provider!.emit("accountsChanged", [A2]);
    await tick();
    release(1n); // A1's late answer
    await connecting;
    await tick();
    expect(w.getState().address).toBe(A2);
    expect(w.getState().balance).toEqual({ status: "ok", atomic: 7_000_000n });
  });
  it("an empty accounts event means the wallet no longer shares an account", async () => {
    const { w, provider } = make();
    await w.connect();
    provider!.emit("accountsChanged", []);
    expect(w.getState().conn).toBe("disconnected");
    expect(w.getState().address).toBeNull();
    expect(w.getState().balance.status).toBe("idle");
    expect(w.getState().notice?.kind).toBe("warn");
  });

  it("tracks chain changes (hex and decimal) and marks the wrong network", async () => {
    const { w, provider } = make();
    await w.init(CFG);
    await w.connect();
    expect(w.getState().chain).toBe("ok");
    provider!.emit("chainChanged", "0x1");
    expect(w.getState()).toMatchObject({ chain: "wrong", chainId: 1 });
    provider!.emit("chainChanged", "42220");
    expect(w.getState()).toMatchObject({ chain: "ok", chainId: 42220 });
    provider!.emit("chainChanged", "garbage");
    expect(w.getState().chain).toBe("unknown");
  });

  it("handles the provider's disconnect event", async () => {
    const { w, provider } = make();
    await w.connect();
    provider!.emit("disconnect", { code: 4900 });
    expect(w.getState().conn).toBe("disconnected");
    expect(w.getState().address).toBeNull();
    expect(w.getState().notice?.text).toMatch(/lost its connection/i);
  });

  describe("network switching", () => {
    it("switches and then re-reads the chain", async () => {
      const { w, provider } = make();
      provider!.chainId = "0x1";
      await w.init(CFG);
      await w.connect();
      expect(w.getState().chain).toBe("wrong");
      await w.switchNetwork();
      expect(provider!.log.filter((m) => m === "eth_chainId").length).toBeGreaterThanOrEqual(2); // re-read after the switch
      expect(w.getState()).toMatchObject({ chain: "ok", busy: false, notice: null });
    });
    it("adds the chain when the wallet does not know it (4902), then re-reads", async () => {
      const { w, provider } = make();
      provider!.chainId = "0x1";
      provider!.handlers.wallet_switchEthereumChain = () => {
        throw rpcError(4902, "Unrecognized chain ID");
      };
      await w.init(CFG);
      await w.connect();
      await w.switchNetwork();
      expect(provider!.log).toContain("wallet_addEthereumChain");
      expect(w.getState().chain).toBe("ok");
    });
    it("never assumes success: a switch that resolves but does not change the chain is reported", async () => {
      const { w, provider } = make();
      provider!.chainId = "0x1";
      provider!.handlers.wallet_switchEthereumChain = () => null; // resolves, changes nothing
      await w.init(CFG);
      await w.connect();
      await w.switchNetwork();
      expect(w.getState().chain).toBe("wrong");
      expect(w.getState().notice?.text).toMatch(/didn't switch/i);
    });
    it("handles a rejected switch", async () => {
      const { w, provider } = make();
      provider!.chainId = "0x1";
      provider!.handlers.wallet_switchEthereumChain = () => {
        throw rpcError(4001);
      };
      await w.init(CFG);
      await w.connect();
      await w.switchNetwork();
      expect(w.getState()).toMatchObject({ chain: "wrong", busy: false });
      expect(w.getState().notice).toEqual({ kind: "info", text: "Network switch cancelled." });
    });
    it("handles a failed switch", async () => {
      const { w, provider } = make();
      provider!.chainId = "0x1";
      provider!.handlers.wallet_switchEthereumChain = () => {
        throw new Error("nope");
      };
      await w.init(CFG);
      await w.connect();
      await w.switchNetwork();
      expect(w.getState().notice?.kind).toBe("warn");
      expect(w.getState().busy).toBe(false);
    });
    it("uses the Sepolia chain id on a test deployment", async () => {
      const { w, provider } = make();
      provider!.chainId = "0xa4ec";
      await w.init({ chainId: SEPOLIA, token: "USDC", agentWallet: PAY_TO });
      await w.connect();
      expect(w.getState().chain).toBe("wrong");
      await w.switchNetwork();
      expect(provider!.chainId).toBe("0xaa044c");
      expect(w.getState().chain).toBe("ok");
    });
  });

  describe("balance failures", () => {
    it("a failed read is 'unavailable', not zero, and never shown as a balance", async () => {
      const { w } = make({ balance: async () => Promise.reject(new Error("rpc down")) });
      await w.init(CFG);
      await w.connect();
      const s = w.getState();
      expect(s.balance).toEqual({ status: "unavailable", atomic: null });
      expect(s.balanceText).toBeNull();
    });
    it("a later refresh can recover", async () => {
      let fail = true;
      const { w } = make({ balance: async () => (fail ? Promise.reject(new Error("x")) : 3_000_000n) });
      await w.init(CFG);
      await w.connect();
      expect(w.getState().balance.status).toBe("unavailable");
      fail = false;
      await w.refreshBalance();
      expect(w.getState().balance).toEqual({ status: "ok", atomic: 3_000_000n });
    });
    it("reads the balance even while the wallet is on the wrong network", async () => {
      const { w, provider, readBalance } = make();
      provider!.chainId = "0x1";
      await start(w, provider!);
      expect(w.getState().chain).toBe("wrong");
      expect(readBalance).toHaveBeenCalledTimes(1);
    });
  });

  describe("local disconnect (stop using the wallet here)", () => {
    it("clears cPilot's session and removes the listeners, without claiming to revoke the wallet's permission", async () => {
      const { w, provider } = make();
      await w.init(CFG);
      await w.connect();
      w.disconnect();
      const s = w.getState();
      expect(s.conn).toBe("disconnected");
      expect(s.address).toBeNull();
      expect(s.balance.status).toBe("idle");
      for (const ev of ["accountsChanged", "chainChanged", "disconnect"]) expect(provider!.count(ev)).toBe(0);
      expect(provider!.log).not.toContain("wallet_revokePermissions"); // a site cannot revoke it, and we do not pretend to
    });
    it("remembers the choice for this tab in session storage, so a reload does not silently reconnect", async () => {
      const storage = memStorage();
      const first = make({ storage });
      await first.w.init(CFG);
      await first.w.connect();
      first.w.disconnect();
      expect(storage.m.get("cp_wallet_cleared")).toBe("1");
      const reloaded = make({ storage }); // same tab, same storage
      await reloaded.w.init(CFG);
      expect(reloaded.w.getState().conn).toBe("disconnected");
      expect(reloaded.provider!.log).not.toContain("eth_accounts");
    });
    it("a new session silently restores an already-authorised account (no popup)", async () => {
      const { w, provider } = make();
      await w.init(CFG);
      expect(w.getState()).toMatchObject({ conn: "connected", address: A1, chain: "ok" });
      expect(provider!.log).toContain("eth_accounts");
      expect(provider!.log).not.toContain("eth_requestAccounts");
    });
    it("does not restore when the wallet has no authorised account", async () => {
      const { w, provider } = make();
      provider!.accounts = [];
      await w.init(CFG);
      expect(w.getState().conn).toBe("disconnected");
    });
    it("connecting again clears the choice", async () => {
      const storage = memStorage();
      const { w } = make({ storage });
      await w.init(CFG);
      w.disconnect();
      await w.connect();
      expect(storage.m.has("cp_wallet_cleared")).toBe(false);
      expect(w.getState().conn).toBe("connected");
    });
    it("ignores wallet events after the customer stopped using the wallet", async () => {
      const { w, provider } = make();
      await w.init(CFG);
      w.disconnect();
      provider!.emit("accountsChanged", [A2]);
      expect(w.getState().address).toBeNull();
    });
    it("falls back to an in-memory flag when storage throws", async () => {
      const throwing = {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("blocked");
        },
        removeItem: () => {
          throw new Error("blocked");
        },
      };
      const { w } = make({ storage: throwing });
      await w.init(CFG);
      expect(w.getState().conn).toBe("connected");
      w.disconnect();
      expect(w.getState().conn).toBe("disconnected");
      await w.init(CFG); // same page, flag held in memory
      expect(w.getState().conn).toBe("disconnected");
    });
    it("works without any storage", async () => {
      const { w } = make({ storage: null });
      await w.init(CFG);
      w.disconnect();
      expect(w.getState().conn).toBe("disconnected");
    });
  });

  it("notifies subscribers, supports unsubscribe, and survives a throwing subscriber", async () => {
    const { w } = make();
    const seen: string[] = [];
    const un = w.subscribe((s) => seen.push(s.conn));
    w.subscribe(() => {
      throw new Error("bad subscriber");
    });
    await w.init(CFG);
    expect(seen[0]).toBe("disconnected"); // current state on subscribe
    expect(seen).toContain("connected");
    un();
    const n = seen.length;
    w.disconnect();
    expect(seen.length).toBe(n);
  });

  it("destroy() removes listeners", async () => {
    const { w, provider } = make();
    await w.connect();
    w.destroy();
    for (const ev of ["accountsChanged", "chainChanged", "disconnect"]) expect(provider!.count(ev)).toBe(0);
  });

  it("works with a provider that has no event support", async () => {
    const p = new FakeProvider() as any;
    p.on = undefined;
    const { w } = make({ provider: p });
    await w.init(CFG);
    await w.connect();
    expect(w.getState().conn).toBe("connected");
  });
});

describe("can the customer pay right now?", () => {
  const net = netConfigFor(MAINNET)!;
  const state = (over: Partial<WalletState> = {}): WalletState => ({
    conn: "connected",
    address: A1,
    shortAddress: shortAddress(A1),
    chainId: MAINNET,
    chain: "ok",
    balance: { status: "ok", atomic: 1_000_000n },
    balanceText: "1.00",
    portfolio: [],
    busy: false,
    config: { ok: true, net, agentWallet: PAY_TO },
    symbol: "USA₮",
    netName: "Celo",
    notice: null,
    ...over,
  });
  const PRICE = 32000n;

  it("ready: connected, right network, enough balance", () => {
    expect(computeReadiness(state(), PRICE)).toMatchObject({ canPay: true, needsConfirm: false, action: "pay", label: "Pay 0.032 USA₮" });
  });
  it("ready when the balance equals the price exactly, not when it is one unit short", () => {
    expect(computeReadiness(state({ balance: { status: "ok", atomic: PRICE } }), PRICE).canPay).toBe(true);
    const short = computeReadiness(state({ balance: { status: "ok", atomic: PRICE - 1n } }), PRICE);
    expect(short).toMatchObject({ canPay: false, label: "Not enough USA₮" });
    expect(short.reason).toBe("This report costs 0.032 USA₮. Your balance is 0.031999 USA₮.");
  });
  it("unknown balance is never treated as sufficient: pay is possible only after explicit confirmation", () => {
    const r = computeReadiness(state({ balance: { status: "unavailable", atomic: null }, balanceText: null }), PRICE);
    expect(r).toMatchObject({ canPay: true, needsConfirm: true, action: "pay", kind: "warn" });
    expect(r.label).toBe("Pay 0.032 USA₮ (balance not checked)");
    expect(r.reason).toMatch(/couldn't check/i);
  });
  it("a zero balance is not the same as an unknown balance", () => {
    const zero = computeReadiness(state({ balance: { status: "ok", atomic: 0n } }), PRICE);
    expect(zero).toMatchObject({ canPay: false, needsConfirm: false });
  });
  it("waits while the balance is loading", () => {
    for (const status of ["idle", "loading"] as const) expect(computeReadiness(state({ balance: { status, atomic: null } }), PRICE)).toMatchObject({ canPay: false, label: "Checking balance…" });
  });
  it("asks to switch on the wrong or unreadable network", () => {
    expect(computeReadiness(state({ chain: "wrong", chainId: 1 }), PRICE)).toMatchObject({ canPay: false, action: "switch", label: "Switch to Celo" });
    expect(computeReadiness(state({ chain: "unknown", chainId: null }), PRICE)).toMatchObject({ canPay: false, action: "switch" });
  });
  it("asks to connect when no account is connected", () => {
    expect(computeReadiness(state({ conn: "disconnected", address: null }), PRICE)).toMatchObject({ canPay: false, action: "connect", label: "Connect wallet to pay" });
  });
  it("explains a missing wallet and the mobile limitation", () => {
    const r = computeReadiness(state({ conn: "no-provider", address: null }), PRICE);
    expect(r).toMatchObject({ canPay: false, action: "help", label: "Open in your wallet app" });
    expect(r.reason).toMatch(/wallet app's own browser/i);
  });
  it("is disabled while connecting or switching, and without a plan", () => {
    expect(computeReadiness(state({ conn: "connecting", busy: true }), PRICE)).toMatchObject({ canPay: false, label: "Connecting…" });
    expect(computeReadiness(state({ busy: true }), PRICE)).toMatchObject({ canPay: false, label: "Working…" });
    expect(computeReadiness(state(), null)).toMatchObject({ canPay: false, label: "Review your plan first" });
  });
  it("names USDC on a test deployment", () => {
    const sepolia = netConfigFor(SEPOLIA)!;
    const r = computeReadiness(state({ config: { ok: true, net: sepolia, agentWallet: PAY_TO }, symbol: "USDC", netName: "Celo Sepolia", chainId: SEPOLIA }), PRICE);
    expect(r.label).toBe("Pay 0.032 USDC");
  });
});

describe("payment errors in plain words", () => {
  const text = (e: unknown) => explainPaymentError(e).text;
  it("never shows raw HTTP, RPC or stack text", () => {
    const samples = [
      Object.assign(new Error("HTTP 402"), { status: 402 }),
      new Error("Failed to create payment payload: boom 0xdeadbeef"),
      new Error("internal error at node:internal/modules (stack)"),
    ];
    for (const e of samples) expect(text(e)).not.toMatch(/HTTP 402|0xdeadbeef|node:internal|stack|Failed to create/);
  });
  it("a cancelled signature is calm", () => {
    expect(explainPaymentError(rpcError(4001)).kind).toBe("info");
    expect(text(new Error("Failed to create payment payload: User rejected the request."))).toMatch(/cancelled/i);
  });
  it("maps every guard code, including after x402 wraps the message", () => {
    expect(text(new Error("Failed to create payment payload: Payment creation aborted: cpilot_guard:amount"))).toMatch(/didn't match your approved quote/);
    expect(text(new Error("cpilot_guard:account"))).toMatch(/account changed/i);
    expect(text(new Error("cpilot_guard:chain"))).toMatch(/different network/i);
    expect(text(new Error("cpilot_guard:plan_missing"))).toMatch(/review the plan/i);
    expect(text(new Error("cpilot_guard:busy"))).toMatch(/already in progress/i);
    expect(text(new Error("cpilot_guard:something_new"))).toMatch(/didn't match/);
  });
  it("maps x402's own spend-control refusal to the same plain mismatch message", () => {
    const e = new Error("Failed to create payment payload: All payment requirements were rejected by spendControls.allowedAssets maxAmountPerPayment. Raise the per-asset cap");
    expect(text(e)).toMatch(/didn't match your approved quote/);
    expect(text(e)).not.toMatch(/spendControls|allowedAssets/);
  });
  it("a refused payment after signing does not claim success or failure of the report, and asks to check the wallet", () => {
    const t = text(Object.assign(new Error("HTTP 402"), { status: 402, body: {} }));
    expect(t).toMatch(/wasn't accepted/);
    expect(t).toMatch(/check your wallet's activity/i);
  });
  it("uses the server's own customer-facing text for 400, 429, 502 and 503", () => {
    for (const status of [400, 429, 502, 503]) {
      const e = Object.assign(new Error("x"), { status, body: { error: "Please wait a while and try again." } });
      expect(text(e)).toBe("Please wait a while and try again.");
    }
  });
  it("an unknown or used quote (HTTP 404) warns the customer not to pay again if their wallet shows a payment", () => {
    const e = Object.assign(new Error("unknown or already used plan"), { status: 404 });
    expect(explainPaymentError(e)).toEqual({
      kind: "warn",
      text: "This quote is no longer available. If your wallet shows a payment for this report, do not pay again. Check your payment activity or contact support before trying again.",
    });
  });
  it("a network failure asks the customer to check the wallet before retrying", () => {
    expect(text(new TypeError("Failed to fetch"))).toMatch(/check its activity before trying again/i);
  });
  it("falls back to a generic message", () => {
    expect(text(new Error("???"))).toMatch(/something went wrong/i);
    expect(explainPaymentError(undefined).kind).toBe("error");
  });
});
