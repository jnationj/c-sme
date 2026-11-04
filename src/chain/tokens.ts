/**
 * Celo mainnet (42220) stablecoins we handle. Values verified against the live facilitator
 * config (https://api.x402.celo.org/api/config) on 2026-11-04. Re-verify before mainnet use.
 *
 * Do not read EIP-712 domains from the contracts: eip712Domain()/version() revert on these tokens.
 * Use the `name`/`version` below. USDT and USAT also have 18-decimal fee-currency adapters with the
 * same name/symbol; never price against an adapter (10^12 error). We only ever use the 6-decimal tokens.
 */
export interface Token {
  symbol: "USDC" | "USDT" | "USAT";
  address: `0x${string}`;
  decimals: 6;
  eip712: { name: string; version: string };
}

export const CELO_MAINNET_ID = 42220;
export const CELO_SEPOLIA_ID = 11142220;

export const TOKENS: Record<Token["symbol"], Token> = {
  USDC: {
    symbol: "USDC",
    address: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C",
    decimals: 6,
    eip712: { name: "USDC", version: "2" },
  },
  USDT: {
    symbol: "USDT",
    address: "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e",
    decimals: 6,
    eip712: { name: "Tether USD", version: "1" },
  },
  USAT: {
    symbol: "USAT",
    address: "0xD2ab3C9A02DBBAB236BfEC45D1d755DF4267F771",
    decimals: 6,
    eip712: { name: "Tether America USD", version: "1" },
  },
};

/** Celo Sepolia has USDC only (development). */
export const SEPOLIA_USDC: Token = {
  symbol: "USDC",
  address: "0x01C5C0122039549AD1493B8220cABEdD739BC44E",
  decimals: 6,
  eip712: { name: "USDC", version: "2" },
};

/** "0.05" -> 50000n. Rejects anything that is not a plain non-negative decimal with <= 6 places. */
export function parseUsd(value: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(value.trim());
  if (!m) throw new Error(`invalid USD amount: ${JSON.stringify(value)}`);
  const whole = BigInt(m[1]!);
  const frac = BigInt((m[2] ?? "").padEnd(6, "0"));
  return whole * 1_000_000n + frac;
}

/** 50000n -> "0.05" */
export function formatUsd(atomic: bigint): string {
  const whole = atomic / 1_000_000n;
  const frac = (atomic % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}
