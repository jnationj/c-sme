// Loads the sign-in bundle (auth.js) on demand. This file lives in the INITIAL bundle, so it must stay tiny and must never import
// Privy or anything that does. It only knows a script address and what window.CPAuth looks like (types only).
import type { AuthHost } from "./auth-types.js";

export const AUTH_LOAD_FAILED = "Email sign-in couldn't be loaded. Check your connection and try again, or connect a browser wallet.";
export const AUTH_INIT_FAILED = "Email wallet sign-in couldn't initialize. Retry or connect a browser wallet.";

export interface LoaderDeps {
  /** Adds the script and resolves when it has loaded (browser: a <script> tag). Rejects if it cannot be fetched. */
  addScript(src: string): Promise<void>;
  /** Reads window.CPAuth after the script ran. */
  getHost(): AuthHost | undefined;
}

export function createAuthLoader(src: string, deps: LoaderDeps) {
  let pending: Promise<AuthHost> | null = null;
  let requests = 0;
  return {
    /** Has anything asked for the bundle yet? (Used to prove it is never downloaded before the customer chooses email or Google.) */
    requested: (): boolean => requests > 0,
    load(): Promise<AuthHost> {
      if (pending) return pending;
      requests++;
      pending = deps
        .addScript(src)
        .then(() => {
          const h = deps.getHost();
          if (!h) throw new Error("sign-in bundle did not register itself");
          return h;
        })
        .catch((e) => {
          pending = null; // a failed download can be tried again
          throw Object.assign(new Error(AUTH_LOAD_FAILED), { cause: e });
        });
      return pending;
    },
  };
}
export type AuthLoader = ReturnType<typeof createAuthLoader>;
