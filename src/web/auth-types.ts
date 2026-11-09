// The contract between the INITIAL bundle (client.js) and the lazily loaded sign-in bundle (auth.js).
// TYPES ONLY: nothing here may import runtime code, so importing this file can never pull Privy into the initial bundle.
import type { Eip1193Provider } from "./wallet.js";

export type AuthStatus =
  | "loading" // the sign-in tools are starting up
  | "idle" // nobody is signed in
  | "sending-code" // asking for the email code
  | "awaiting-code" // the customer is typing the code from their email
  | "verifying" // checking the code
  | "redirecting" // on the way to Google
  | "finishing" // signed in, waiting for the wallet to appear or be opened
  | "creating-wallet" // signed in, and Privy is creating the embedded wallet (headless sign-in does not do this by itself)
  | "ready" // signed in, embedded wallet available
  | "error";

export type AuthMethod = "email" | "google";

/** Which step failed. Lets the page, the tests and the debug log tell the cases apart without ever carrying raw SDK text. */
export type AuthFailure =
  | "create" // Privy could not create the wallet
  | "timeout" // the wallet did not appear in time
  | "provider" // the wallet exists but its provider could not be obtained or did not answer
  | "mismatch" // the provider reports a different account than the wallet
  | "connect" // handing the wallet to the wallet bridge failed
  | "cancelled" // the customer stopped waiting for the wallet (a request already sent to Privy is not recalled)
  | "sdk" // the sign-in tools started but Privy did not become ready (it reported an error, or took too long)
  | "setup"; // the sign-in tools themselves could not start

export interface AuthState {
  status: AuthStatus;
  /** Customer-facing text. Never raw SDK or HTTP text. */
  error: string | null;
  /** Which step failed, when error is set after a wallet step. */
  failure: AuthFailure | null;
  /** The embedded wallet's address, when status is "ready". */
  address: string | null;
  /** How this session signed in, when known (not known after a page reload). */
  method: AuthMethod | null;
  /** The email being verified. Kept only in the page, only to show the customer where the code went. */
  email: string | null;
  /** Who is signed in, for display ("ada@example.com"), when the SDK reports it. Never sent anywhere by cPilot. */
  label: string | null;
  /** "login": the customer just signed in. "restored": an earlier session was found. */
  origin: "login" | "restored" | null;
  /** True while the embedded wallet is the wallet cPilot is using (as opposed to signed in but not selected). */
  active: boolean;
  /** True while an export request is in flight or Privy reports one of its modal screens open. */
  exportInProgress: boolean;
  modalOpen: boolean;
}

export interface AuthCallbacks {
  /** The embedded wallet's provider is ready to be used. `restored` means the SDK brought back an earlier session by itself. */
  onConnected(provider: Eip1193Provider, address: string, info: { method: AuthMethod | null; restored: boolean }): void;
  /** The embedded wallet is gone (signed out, or the session ended). */
  onDisconnected(): void;
}

export interface AuthInit extends AuthCallbacks {
  /** The Celo network the server says cPilot pays on. */
  chainId: number;
}

/** What window.CPAuth offers once auth.js has loaded. Everything here is customer-initiated; nothing signs. */
export interface AuthHost {
  /**
   * Starts the sign-in tools. The returned promise resolves once they can accept calls (their operations are attached), or after a
   * bounded wait, so calls made right after init() can never reach tools that are not there yet. It never waits indefinitely.
   */
  init(opts: AuthInit): Promise<void>;
  getState(): AuthState;
  subscribe(fn: (s: AuthState) => void): () => void;
  /** Step 1 of email sign-in: send a one-time code. */
  sendCode(email: string): Promise<void>;
  /** Step 2: check the code the customer typed. */
  verifyCode(code: string): Promise<void>;
  /** Continue with Google. Goes to Google and comes back to this page. If already signed in, just selects the wallet. */
  google(): Promise<void>;
  /** Back out of an unfinished sign-in, or stop waiting for the wallet. It cannot recall a request already sent to Privy. */
  cancel(): void;
  /** Try the wallet step again for a customer who is already signed in. Never starts a login. */
  retryWallet(): void;
  /** Use the signed-in embedded wallet (after another wallet had been selected). */
  activate(): void;
  /** Another wallet took over: stop using this one but keep the Privy session. */
  deactivate(): void;
  /** Sign out of Privy. */
  logout(): Promise<void>;
  /** Opens Privy's own export screen. The customer reads their key there, on Privy's domain. cPilot never receives it. */
  exportKey(): Promise<void>;
}

declare global {
  interface Window {
    CPAuth?: AuthHost;
  }
}
