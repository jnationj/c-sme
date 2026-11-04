import { withAttribution } from "@celo/attribution-tags";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo, celoSepolia } from "viem/chains";

/**
 * The only place that builds a wallet client. Every direct transaction the agent sends goes through
 * here, so every one carries the entry's ERC-8021 attribution tag. (Facilitator-submitted x402
 * settlements cannot carry our tag; those are credited by PayTo address, per the Loops FAQ.)
 */
export function makeClients(opts: { privateKey: `0x${string}`; attributionTag: string; rpcUrl?: string; testnet?: boolean }) {
  const chain = opts.testnet ? celoSepolia : celo;
  const transport = http(opts.rpcUrl);
  const account = privateKeyToAccount(opts.privateKey);
  const wallet = createWalletClient({ account, chain, transport }).extend(withAttribution(opts.attributionTag));
  const publicClient = createPublicClient({ chain, transport });
  return { account, wallet, publicClient, chain };
}
