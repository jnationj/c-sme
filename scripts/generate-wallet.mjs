// Generates a fresh agent wallet LOCALLY and stores the private key in .env (gitignored).
// Prints ONLY the public address. The key is never printed, so it can't leak into chat or logs.
//
//   pnpm wallet:new
//
// Refuses to overwrite an existing AGENT_PRIVATE_KEY.
import { existsSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const envPath = new URL("../.env", import.meta.url);
const existing = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";

if (/^AGENT_PRIVATE_KEY=0x[0-9a-fA-F]{64}\s*$/m.test(existing)) {
  const key = existing.match(/^AGENT_PRIVATE_KEY=(0x[0-9a-fA-F]{64})/m)[1];
  console.log("A wallet already exists in .env. Not overwriting.");
  console.log("Address:", privateKeyToAccount(key).address);
  process.exit(0);
}

const privateKey = generatePrivateKey();
const { address } = privateKeyToAccount(privateKey);
const line = `AGENT_PRIVATE_KEY=${privateKey}\n`;

if (/^AGENT_PRIVATE_KEY=\s*$/m.test(existing)) {
  writeFileSync(envPath, existing.replace(/^AGENT_PRIVATE_KEY=\s*$/m, line.trimEnd()));
} else {
  appendFileSync(envPath, (existing && !existing.endsWith("\n") ? "\n" : "") + line);
}

console.log("Wallet created. Private key saved to .env (never share or commit it).");
console.log("Agent wallet address (public, safe to share):", address);
console.log("");
console.log("NEXT: back up .env somewhere private (password manager). If you lose the key, you lose the wallet.");
