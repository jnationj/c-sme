// Recognising a Privy embedded wallet. Pure logic: no React, no SDK import, no `window`, so it is unit-tested in Node.
//
// WHAT THE INSTALLED SDK (@privy-io/react-auth 3.51.3) SAYS, so this is not guesswork:
//  - Its own funding code treats a linked wallet account as an embedded Privy wallet when
//    `walletClientType === "privy" || walletClientType === "privy-v2"` (use-headless-crypto-deposit chunk).
//  - Its type comments on linked wallet accounts say the same ("walletClientType === 'privy' or 'privy-v2'").
//  - Its type for a CONNECTED wallet (what useWallets returns) lists only "privy" (EMBEDDED_WALLET_CLIENT_TYPES = ["privy"]).
//  - Its own "create on login" decision checks only "privy" on linked accounts.
// So both values are accepted in both places: wrongly treating an existing "privy-v2" wallet as absent would make cPilot call
// createWallet for a user who already has one. UNRESOLVED without a real account: which of the two values a wallet in your
// dashboard configuration actually carries.

/** True for the wallet-client types Privy uses for its own embedded wallets. */
export function isEmbeddedWalletClientType(t: unknown): boolean {
  return t === "privy" || t === "privy-v2";
}

/**
 * Does this Privy user already hold an embedded ETHEREUM wallet? `linkedAccounts` is the SDK's `user.linkedAccounts`.
 * Anything unreadable counts as "no".
 */
export function hasEmbeddedEthereumWallet(linkedAccounts: readonly unknown[] | null | undefined): boolean {
  if (!Array.isArray(linkedAccounts)) return false;
  return linkedAccounts.some((a) => {
    if (typeof a !== "object" || a === null) return false;
    const x = a as { type?: unknown; chainType?: unknown; walletClientType?: unknown };
    return x.type === "wallet" && x.chainType === "ethereum" && isEmbeddedWalletClientType(x.walletClientType);
  });
}

/** The embedded wallet among the SDK's connected wallets (useWallets), if it is listed. */
export function findEmbeddedWallet<T extends { walletClientType?: unknown }>(wallets: readonly T[] | null | undefined): T | undefined {
  return Array.isArray(wallets) ? wallets.find((w) => isEmbeddedWalletClientType(w?.walletClientType)) : undefined;
}
