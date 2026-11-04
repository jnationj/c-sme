// Creates a THROWAWAY Sepolia test buyer wallet. Key goes to .env.buyer (gitignored); only the address is printed.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const path = new URL("../.env.buyer", import.meta.url);
let key;
if (existsSync(path)) key = readFileSync(path, "utf8").match(/^BUYER_PRIVATE_KEY=(0x[0-9a-fA-F]{64})/m)?.[1];
if (!key) {
  key = generatePrivateKey();
  writeFileSync(path, `BUYER_PRIVATE_KEY=${key}\n`);
}
console.log("Test buyer address (public, Sepolia only):", privateKeyToAccount(key).address);
