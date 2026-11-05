import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const buyBin = join(dirname(require.resolve("@celo/buy/package.json")), "dist", "main.js");

export interface BuyResult {
  transaction: string | null;
  paidAtomic: string | null;
  token: string | null;
  output: unknown;
}

export class BuyError extends Error {
  constructor(message: string, readonly paymentMayHaveHappened: boolean) {
    super(message);
  }
}

const SAFE_FAIL_CODES = ["unexpected_response", "invalid_request", "insufficient_funds", "no_account"];

/** Pays one catalog call via the buy CLI (x402). Spawns the CLI without a shell, so the body is never shell-parsed. */
export function buyCall(opts: { url: string; body: unknown; account: string; sandbox: boolean; token: string; maxAmount: string; timeoutMs?: number }): Promise<BuyResult> {
  const args = [buyBin, ...(opts.sandbox ? ["-s"] : []), "--account", opts.account, "curl", "--token", opts.token, "--max-amount", opts.maxAmount, "-sS", "-X", "POST", opts.url, "-H", "content-type: application/json", "-d", JSON.stringify(opts.body)];
  return new Promise((resolve, reject) => {
    execFile(process.execPath, args, { timeout: opts.timeoutMs ?? 120_000, maxBuffer: 20_000_000 }, (err, stdout, stderr) => {
      if (err) {
        const killed = (err as any).killed === true;
        const code = /"code":"([a-z_]+)"/.exec(stderr + stdout)?.[1];
        const safe = !killed && !!code && SAFE_FAIL_CODES.includes(code);
        return reject(new BuyError(`${code ?? (killed ? "timeout" : "buy_failed")}: ${(stderr || stdout || err.message).slice(0, 300)}`, !safe));
      }
      try {
        const j = JSON.parse(stdout);
        // The gateway can answer 502 provider_error while buy exits 0. Never treat that as a success.
        if (j.error) {
          const notCharged = j.paymentSettled === false;
          return reject(new BuyError(`${j.error}${j.providerStatus ? ` (provider ${j.providerStatus})` : ""}: not charged=${notCharged}`, !notCharged));
        }
        if (!j.transaction) return reject(new BuyError("response had no transaction hash; payment state unknown", true));
        resolve({ transaction: j.transaction ?? null, paidAtomic: j.payment?.atomic ?? null, token: j.payment?.token ?? null, output: j.output ?? j });
      } catch {
        reject(new BuyError("unparseable buy response (payment may have settled)", true));
      }
    });
  });
}
