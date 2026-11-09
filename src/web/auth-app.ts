// The lazily loaded sign-in bundle (web/auth.js). It is built separately from client.js and downloaded only when the customer
// chooses email or a previous Privy session needs to be restored.
//
// Privy React SDK, used HEADLESS: no Privy login screen is shown. cPilot's own dialog collects the email and the code.
// The only Privy exports this app may use are listed in the imports below; test/guard-bypass.test.ts fails if any other is added
// (no signing, sending, funding or raw-key hooks). Exporting a key is customer-initiated and happens on Privy's own domain.
import { createElement as h, useEffect, useRef, Component, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { PrivyProvider, useCreateWallet, useExportWallet, useLoginWithEmail, useLoginWithOAuth, useModalStatus, usePrivy, useWallets } from "@privy-io/react-auth";
import { netConfigFor, type Eip1193Provider } from "./wallet.js";
import { createAuthSession, TEXT, type AuthSession } from "./auth-session.js";
import { findEmbeddedWallet, hasEmbeddedEthereumWallet } from "./auth-wallets.js";
import type { AuthHost, AuthInit } from "./auth-types.js";

// Public identifiers baked in at build time by scripts/client-build.mjs. They are not secrets.
declare const __PRIVY_APP_ID__: string;
declare const __PRIVY_CLIENT_ID__: string;

const APP_ID = typeof __PRIVY_APP_ID__ === "string" ? __PRIVY_APP_ID__ : "";
const CLIENT_ID = typeof __PRIVY_CLIENT_ID__ === "string" ? __PRIVY_CLIENT_ID__ : "";

/**
 * A Celo chain as Celo documents it (name, CELO symbol, RPC, explorer), from the same bundled network table the wallet controller uses.
 * Plain objects on purpose: importing viem here would put a second copy of it in this bundle next to the one Privy brings.
 */
function celoChain(id: number) {
  const net = netConfigFor(id);
  if (!net) throw new Error("unsupported network " + id);
  return {
    id: net.chainId,
    name: net.name,
    nativeCurrency: { name: "Celo", symbol: "CELO", decimals: 18 },
    rpcUrls: { default: { http: [net.rpcUrl] } },
    blockExplorers: { default: { name: "Blockscout", url: net.explorer } },
    testnet: net.testnet,
  };
}

const oauthReturn = (() => {
  try {
    return /[?&]privy_oauth_(code|state|provider)=/.test(location.search);
  } catch {
    return false;
  }
})();
// Developer diagnostics only: which step failed and a short code. Never SDK text, never anything about the customer.
const session: AuthSession = createAuthSession({
  oauthReturn,
  log: (stage, code) => console.debug("cPilot sign-in step failed:", stage, code),
  oauthDiagnostic: (diagnostic) => {
    if (location.hostname === "localhost" || location.hostname === "127.0.0.1" || location.hostname === "[::1]") {
      console.debug("cPilot Google OAuth diagnostic:", diagnostic);
    }
  },
});

/** Lives inside PrivyProvider. Feeds the session what the SDK knows, and hands it the few operations it may perform. */
function Glue(props: { session: AuthSession }) {
  const { session: s } = props;
  const privy = usePrivy();
  const email = useLoginWithEmail({ onError: (e) => s.reportLoginError(e) });
  const oauth = useLoginWithOAuth({ onError: (e) => s.reportLoginError(e) });
  const { isOpen: privyModalOpen } = useModalStatus();
  const { wallets, ready: walletsReady } = useWallets();
  const { exportWallet } = useExportWallet();
  // Privy's own wallet creation. Headless sign-in does not create the embedded wallet by itself (createOnLogin only applies to Privy's
  // login screens), so after sign-in the session asks for it once through this. It creates a wallet and does nothing else.
  const { createWallet } = useCreateWallet({
    onSuccess: () => s.reportCreateSuccess(),
    onError: (e) => s.reportCreateError(String(e)),
  });

  const latest = useRef({ privy, email, oauth, exportWallet, createWallet });
  latest.current = { privy, email, oauth, exportWallet, createWallet };
  useEffect(() => {
    s.attachOps({
      sendEmailCode: (e) => latest.current.email.sendCode({ email: e }),
      loginWithEmailCode: (c) => latest.current.email.loginWithCode({ code: c }),
      startGoogle: () => latest.current.oauth.initOAuth({ provider: "google" }),
      logout: () => latest.current.privy.logout(),
      // Awaited by the session, which also hears onSuccess / onError above. The result (a wallet object) is not read here.
      createWallet: async () => {
        await latest.current.createWallet();
      },
      // Opens Privy's own screen on Privy's own domain. The key is shown there, never to this code.
      exportWallet: (address) => latest.current.exportWallet({ address }),
    });
  }, [s]);
  useEffect(() => {
    s.reportModalOpen(privyModalOpen);
  }, [s, privyModalOpen]);

  // The embedded wallet among the connected wallets ("privy", and "privy-v2" if the SDK ever lists it: see auth-wallets.ts).
  const embedded = findEmbeddedWallet(wallets);
  // The provider is always requested from the CURRENT wallet object at the moment it is needed, never from one captured earlier.
  const embeddedRef = useRef(embedded);
  embeddedRef.current = embedded;
  const user = privy.user;
  const label = user?.email?.address ?? user?.google?.email ?? null;
  const address = embedded?.address ?? null;
  const chainKey = embedded ? String(embedded.chainId) : "";
  // The Privy account already holds an embedded Ethereum wallet (it may just not be listed yet): then none must be created.
  const hasEmbeddedWallet = hasEmbeddedEthereumWallet(user?.linkedAccounts);
  // Privy's own report that it failed to start (for example it could not reach its servers). Only whether it did is passed on.
  const initError = !!privy.error;
  useEffect(() => {
    s.applySnapshot({
      ready: privy.ready && walletsReady,
      initError,
      authenticated: privy.authenticated,
      hasEmbeddedWallet,
      wallet: embedded
        ? {
            address: embedded.address,
            chainKey,
            getEthereumProvider: () => {
              const w = embeddedRef.current;
              return w ? (w.getEthereumProvider() as unknown as Promise<Eip1193Provider>) : Promise.reject(new Error("wallet not listed"));
            },
          }
        : null,
      label,
    });
    // `embedded` itself changes identity on every render; its address and chain are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s, privy.ready, walletsReady, privy.authenticated, address, chainKey, label, hasEmbeddedWallet, initError]);
  return null;
}

class Guard extends Component<{ session: AuthSession; children?: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.session.fail(TEXT.loginFailed);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

let mounted = false;
function mount(chainId: number): void {
  if (mounted) return;
  mounted = true;
  try {
    if (!APP_ID) {
      session.fail("Email wallet sign-in isn't set up on this site yet.");
      return;
    }
    const sepolia = celoChain(11142220);
    const mainnet = celoChain(42220);
    // The network the server says cPilot pays on goes first and is the wallet's default. The server still decides; nothing here chooses it.
    const primary = chainId === mainnet.id ? mainnet : chainId === sepolia.id ? sepolia : null;
    if (!primary) throw new Error("unsupported server payment network");
    const secondary = primary === mainnet ? sepolia : mainnet;
    const host = document.createElement("div");
    host.id = "cp-auth-root";
    host.setAttribute("aria-hidden", "true");
    document.body.appendChild(host);
    createRoot(host).render(
      h(Guard, {
        session,
        children: h(PrivyProvider, {
          appId: APP_ID,
          ...(CLIENT_ID ? { clientId: CLIENT_ID } : {}),
          config: {
            loginMethods: ["email"],
            embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" } },
            supportedChains: [primary, secondary],
            defaultChain: primary,
          },
          children: h(Glue, { session }),
        }),
      }),
    );
  } catch {
    session.fail(TEXT.loginFailed);
  }
}

const host: AuthHost = {
  init(o: AuthInit) {
    session.init({ onConnected: o.onConnected, onDisconnected: o.onDisconnected });
    mount(o.chainId);
    // React attaches the session's operations a moment after mount() returns. Hand back a promise for that, so the caller's first
    // action cannot find no operations. It always settles (bounded), and nothing here waits on the caller, so there is no circular wait.
    return session.whenOpsReady();
  },
  getState: () => session.getState(),
  subscribe: (fn) => session.subscribe(fn),
  sendCode: (e) => session.sendCode(e),
  verifyCode: (c) => session.verifyCode(c),
  google: () => session.google(),
  cancel: () => session.cancel(),
  retryWallet: () => session.retryWallet(),
  activate: () => session.activate(),
  deactivate: () => session.deactivate(),
  logout: () => session.logout(),
  exportKey: () => session.exportKey(),
};
window.CPAuth = host;
