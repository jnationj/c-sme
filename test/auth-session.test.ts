import { describe, expect, it, vi } from "vitest";
import { createAuthSession, TEXT } from "../src/web/auth-session.js";
import { createWalletBridge } from "../src/web/wallet-bridge.js";
import type { Eip1193Provider } from "../src/web/wallet.js";
import type { Snapshot } from "../src/web/auth-session.js";

const ADDRESS = "0x1234567890123456789012345678901234567890";
const OTHER = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";

function provider(account = ADDRESS): Eip1193Provider {
  return {
    request: async ({ method }) => {
      if (method === "eth_accounts") return [account];
      throw new Error("unexpected provider request");
    },
  };
}

function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    ready: true,
    authenticated: false,
    hasEmbeddedWallet: false,
    wallet: null,
    label: null,
    ...overrides,
  };
}

describe("email wallet authentication", () => {
  it("requires a valid email and six-digit code before calling Privy login operations", async () => {
    const session = createAuthSession();
    const sendEmailCode = vi.fn(async () => {});
    const loginWithEmailCode = vi.fn(async () => {});
    session.init({ onConnected: vi.fn(), onDisconnected: vi.fn() });
    session.attachOps({
      sendEmailCode,
      loginWithEmailCode,
      startGoogle: vi.fn(),
      logout: vi.fn(),
      createWallet: vi.fn(),
      exportWallet: vi.fn(),
    });
    session.applySnapshot(snapshot());

    await session.sendCode("not-an-email");
    expect(session.getState().error).toBe(TEXT.badEmail);
    expect(sendEmailCode).not.toHaveBeenCalled();

    await session.sendCode("customer@example.com");
    expect(session.getState().status).toBe("awaiting-code");
    await session.verifyCode("12345");
    expect(session.getState().error).toBe(TEXT.badCode);
    expect(loginWithEmailCode).not.toHaveBeenCalled();
  });

  it("creates an embedded wallet only after email verification and verifies the provider account", async () => {
    let session: ReturnType<typeof createAuthSession>;
    const wallet = {
      address: ADDRESS,
      chainKey: "42220",
      getEthereumProvider: async () => provider(),
    };
    const createWallet = vi.fn(async () => {
      session.applySnapshot(snapshot({
        authenticated: true,
        hasEmbeddedWallet: true,
        wallet,
        label: "customer@example.com",
      }));
    });
    const onConnected = vi.fn();
    const onDisconnected = vi.fn();
    session = createAuthSession({ walletTimeoutMs: 1_000 });
    session.init({ onConnected, onDisconnected });
    session.attachOps({
      sendEmailCode: vi.fn(async () => {}),
      loginWithEmailCode: vi.fn(async () => {
        session.applySnapshot(snapshot({ authenticated: true, label: "customer@example.com" }));
      }),
      startGoogle: vi.fn(),
      logout: vi.fn(),
      createWallet,
      exportWallet: vi.fn(),
    });
    session.applySnapshot(snapshot());

    await session.sendCode("customer@example.com");
    await session.verifyCode("123456");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(createWallet).toHaveBeenCalledTimes(1);
    expect(session.getState()).toMatchObject({
      status: "ready",
      address: ADDRESS,
      method: "email",
      origin: "login",
      active: true,
    });
    expect(onConnected).toHaveBeenCalledTimes(1);
    expect(onConnected).toHaveBeenCalledWith(expect.anything(), ADDRESS, { method: "email", restored: false });

    await session.logout();
    expect(session.getState()).toMatchObject({ status: "idle", address: null, active: false });
    expect(onDisconnected).toHaveBeenCalledTimes(1);
  });

  it("restores a previously authenticated embedded wallet without creating another wallet", async () => {
    const onConnected = vi.fn();
    const createWallet = vi.fn();
    const session = createAuthSession({ walletTimeoutMs: 1_000 });
    session.init({ onConnected, onDisconnected: vi.fn() });
    session.attachOps({
      sendEmailCode: vi.fn(),
      loginWithEmailCode: vi.fn(),
      startGoogle: vi.fn(),
      logout: vi.fn(),
      createWallet,
      exportWallet: vi.fn(),
    });
    session.applySnapshot(snapshot({
      authenticated: true,
      hasEmbeddedWallet: true,
      wallet: { address: ADDRESS, chainKey: "42220", getEthereumProvider: async () => provider() },
      label: "customer@example.com",
    }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(session.getState()).toMatchObject({ status: "ready", origin: "restored", active: true });
    expect(createWallet).not.toHaveBeenCalled();
    expect(onConnected).toHaveBeenCalledWith(expect.anything(), ADDRESS, { method: null, restored: true });
  });

  it("refuses a session whose provider account differs from the authenticated wallet", async () => {
    const onConnected = vi.fn();
    const session = createAuthSession({ walletTimeoutMs: 1_000 });
    session.init({ onConnected, onDisconnected: vi.fn() });
    session.applySnapshot(snapshot({
      authenticated: true,
      hasEmbeddedWallet: true,
      wallet: { address: ADDRESS, chainKey: "42220", getEthereumProvider: async () => provider(OTHER) },
    }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(session.getState()).toMatchObject({ status: "error", failure: "mismatch", active: false });
    expect(onConnected).not.toHaveBeenCalled();
  });
});

describe("wallet-source isolation", () => {
  it("prevents one wallet source from disconnecting the other", () => {
    const bridge = createWalletBridge();
    const injectedDisconnect = vi.fn();
    const injectedDeactivate = vi.fn();
    const privyDisconnect = vi.fn();
    const privyDeactivate = vi.fn();
    const p = provider();
    bridge.registerSource("injected", { disconnect: injectedDisconnect, deactivate: injectedDeactivate });
    bridge.registerSource("privy", { disconnect: privyDisconnect, deactivate: privyDeactivate });

    bridge.setConnected("injected", p, ADDRESS, "Browser wallet");
    bridge.setConnected("privy", p, ADDRESS, "Email wallet");
    expect(injectedDeactivate).toHaveBeenCalledTimes(1);
    expect(bridge.setDisconnected("injected")).toBe(false);
    expect(bridge.activeSource()).toBe("privy");

    bridge.disconnect();
    expect(privyDisconnect).toHaveBeenCalledTimes(1);
    expect(privyDeactivate).not.toHaveBeenCalled();
    expect(bridge.getState().connected).toBe(false);
  });
});
