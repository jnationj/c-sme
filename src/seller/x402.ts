import { HTTPFacilitatorClient } from "@x402/core/http";
import { x402ResourceServer } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { paymentMiddleware } from "@x402/hono";
import { TOKENS, SEPOLIA_USDC, type Token } from "../chain/tokens.js";

export type SellerConfig = {
  testnet: boolean;
  payTo: string; // wallet that receives the money (and is the address submitted to Loops)
  apiKey?: string; // facilitator /settle key, server-side only
};

const FACILITATOR = {
  mainnet: "https://api.x402.celo.org",
  testnet: "https://api.x402.sepolia.celo.org",
} as const;
const NETWORK = { mainnet: "eip155:42220", testnet: "eip155:11142220" } as const;

/** Mainnet settles in USA₮; Sepolia only has USDC. Never use the "$0.01" shorthand: it resolves to USDC. */
export function sellerToken(testnet: boolean): Token {
  return testnet ? SEPOLIA_USDC : TOKENS.USAT;
}

/** Atomic price for a request, or undefined if the request cannot be priced (it then gets no paywall price). */
export type PriceFn = (path: string) => bigint | undefined;

export function createPaywall(cfg: SellerConfig, route: string, priceFor: PriceFn, description: string) {
  const token = sellerToken(cfg.testnet);
  const key = cfg.testnet ? "testnet" : "mainnet";
  const auth = cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : undefined;
  const facilitator = new HTTPFacilitatorClient({
    url: FACILITATOR[key],
    createAuthHeaders: async () => ({ verify: {}, supported: {}, ...(auth ? { settle: auth } : {}) }),
  });
  const server = new x402ResourceServer(facilitator).register(NETWORK[key], new ExactEvmScheme());
  return paymentMiddleware(
    {
      [route]: {
        accepts: {
          scheme: "exact",
          network: NETWORK[key],
          payTo: cfg.payTo,
          price: (ctx) => {
            const atomic = priceFor(ctx.path);
            if (atomic === undefined) throw new Error("unknown plan");
            return {
              asset: token.address,
              amount: atomic.toString(),
              extra: { name: token.eip712.name, version: token.eip712.version },
            };
          },
          maxTimeoutSeconds: 120,
        },
        description,
        mimeType: "application/json",
      },
    },
    server,
  );
}
