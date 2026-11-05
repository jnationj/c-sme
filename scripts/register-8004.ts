// Registers the agent in the ERC-8004 Identity Registry from the agent wallet (the wallet that will own the identity).
//
//   pnpm register:8004                      dry run: simulates, prints everything, sends NOTHING
//   pnpm register:8004 -- --send            sends the register() transaction (needs a little CELO for gas)
//   pnpm register:8004 -- --update <id>     after registering: point the registry at a file that includes the agentId
//
// Network follows X402_NETWORK (testnet = Celo Sepolia, mainnet = Celo). Sending on mainnet needs explicit owner approval.
import { parseEventLogs, formatEther, encodeFunctionData } from "viem";
import { fromDataSuffix, toDataSuffix } from "@celo/attribution-tags";
import { makeClients } from "../src/chain/wallet.js";

const REGISTRY = {
  mainnet: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
  testnet: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
} as const;

const abi = [
  { type: "function", name: "register", stateMutability: "nonpayable", inputs: [{ name: "agentURI", type: "string" }], outputs: [{ name: "agentId", type: "uint256" }] },
  { type: "function", name: "setAgentURI", stateMutability: "nonpayable", inputs: [{ name: "agentId", type: "uint256" }, { name: "newURI", type: "string" }], outputs: [] },
  {
    type: "event",
    name: "Registered",
    inputs: [
      { name: "agentId", type: "uint256", indexed: true },
      { name: "agentURI", type: "string" },
      { name: "owner", type: "address", indexed: true },
    ],
  },
] as const;

const args = process.argv.slice(2);
const send = args.includes("--send");
const updateIdx = args.indexOf("--update");
const updateId = updateIdx >= 0 ? BigInt(args[updateIdx + 1] ?? "") : undefined;

const key = process.env.AGENT_PRIVATE_KEY as `0x${string}` | undefined;
if (!key) throw new Error("AGENT_PRIVATE_KEY missing in .env");
const testnet = (process.env.X402_NETWORK ?? "testnet") !== "mainnet";
const net = testnet ? "testnet" : "mainnet";
const tag = process.env.ATTRIBUTION_TAG ?? "celo_d0da34839ac6";
const publicUrl = process.env.PUBLIC_URL;
if (send && !publicUrl) throw new Error("Set PUBLIC_URL (the live demo URL) in .env before sending: it goes into the registration file.");

const { account, wallet, publicClient } = makeClients({ privateKey: key, attributionTag: tag, rpcUrl: process.env.CELO_RPC_URL, testnet });
const registry = REGISTRY[net];

const file: Record<string, unknown> = {
  type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
  name: "CorridorPilot",
  description:
    "Research agent for small businesses and creators. Finds paid social-data sources, shows exact prices, pays providers over x402 on Celo within spending limits, and returns an honest report. Customers pay in USA₮ via Celo's x402 facilitator.",
  services: [{ name: "web", endpoint: publicUrl ?? "https://example.invalid (set PUBLIC_URL)" }],
  x402Support: true,
  active: true,
  supportedTrust: ["reputation"],
};
if (updateId !== undefined) file.registrations = [{ agentId: Number(updateId), agentRegistry: `eip155:${testnet ? 11142220 : 42220}:${registry}` }];

const uri = "data:application/json;base64," + Buffer.from(JSON.stringify(file)).toString("base64");

console.log(`network:   ${net}`);
console.log(`registry:  ${registry}`);
console.log(`owner:     ${account.address}  (this wallet will own the identity)`);
console.log(`balance:   ${formatEther(await publicClient.getBalance({ address: account.address }))} CELO`);
console.log(`file:      ${JSON.stringify(file, null, 2)}`);

const request =
  updateId !== undefined
    ? ({ address: registry, abi, functionName: "setAgentURI", args: [updateId, uri], account } as const)
    : ({ address: registry, abi, functionName: "register", args: [uri], account } as const);

const sim = await publicClient.simulateContract(request as any).then(
  (r) => ({ ok: true as const, r }),
  (e) => ({ ok: false as const, e: e as Error }),
);
if (!sim.ok) {
  console.log("simulation FAILED:", sim.e.message.slice(0, 400));
  process.exit(1);
}
const gas = await publicClient.estimateContractGas(request as any).catch(() => undefined);
console.log(`simulation: OK${gas ? ` (gas ~${gas})` : ""}`);

// Offline proof that the transaction will carry our attribution tag: rebuild the calldata with the suffix and decode it.
{
  const data = encodeFunctionData({ abi, functionName: updateId !== undefined ? "setAgentURI" : "register", args: (request as { args: readonly unknown[] }).args } as never);
  const tagged = (data + toDataSuffix(tag).slice(2)) as `0x${string}`;
  const decoded = fromDataSuffix(tagged);
  const ok = !!decoded && decoded.codes.includes(tag);
  console.log(`tag check: calldata ends with the suffix for "${tag}": ${ok ? "YES" : "NO (do not send)"}`);
  if (!ok) process.exit(1);
}

if (!send) {
  console.log("\nDRY RUN. Nothing was sent. Re-run with --send (after owner approval) to submit the transaction.");
  process.exit(0);
}

const hash = await wallet.writeContract(request as any);
console.log("sent:", hash);
const receipt = await publicClient.waitForTransactionReceipt({ hash });
console.log("status:", receipt.status);
if (updateId === undefined) {
  const [ev] = parseEventLogs({ abi, eventName: "Registered", logs: receipt.logs });
  console.log("agentId:", ev ? ev.args.agentId.toString() : "(Registered event not found: check the receipt)");
  console.log("Next: pnpm register:8004 -- --update <agentId> --send   (adds the registrations entry to the file)");
}
