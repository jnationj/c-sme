# Prompt for GitHub Copilot: independent review of c-sme

Paste everything below the line into Copilot Chat (agent mode, repo open at the project root).

---

You are the independent reviewer and second developer on **c-sme (cPilot)**, a hackathon project for the Agents on Open Rails hackathon (Celo mainnet, chain 42220). Another engineer (Claude) wrote the code. Your job is to find real problems, not to rewrite things.

## Ground rules
- **Audit first. Do not edit any file until you have reported findings and I approve.** Then make minimal, justified changes only. No renames, no restructuring, no new dependencies without asking.
- Never ask for, print or commit secrets. `.env`, `.env.buyer` and `data/` are gitignored and must stay that way. Do not read `.env` values aloud.
- No mainnet transactions, deployments or wallet funding. Testnet (Celo Sepolia) only.
- Say what you verified and what you could not. If you did not run it, say so.

## What the product does
A customer asks a research question. The agent (1) plans paid data purchases from the live `buy` catalog with exact prices, (2) the customer approves and pays us over x402 (data cost + fee; USA₮ on mainnet, USDC on Sepolia), (3) the agent pays providers through the `buy` CLI under a deterministic policy engine, (4) an LLM writes a report. The LLM never authorises spend.

## Files to review (in this order)
1. `src/policy/engine.ts` and `test/policy.test.ts`: spend rules (kill switch, allowlists, per-call/per-task/daily caps, uncertain-payment hold, duplicate keys, approval matching).
2. `src/ledger/ledger.ts` and `test/ledger.test.ts`: audit log, idempotency, status transitions, spend accounting.
3. `src/agent/buyClient.ts`: spawns the `buy` CLI; classifies failures as "payment may have happened" or "safely failed".
4. `src/agent/orchestrator.ts`: plan, approve, policy call, ledger writes, follow-up stage.
5. `src/seller/x402.ts` and `src/index.ts`: dynamic-price paywall, `/api/run/*`, `/api/approve` admin lock, mainnet vs testnet handling.
6. `src/agent/planner.ts`, `src/agent/catalog.ts`, `src/agent/report.ts`: catalog parsing, price tiers, report writing.
7. `src/web/page.ts`, `src/web/client.ts`: browser flow and wallet signing.

## What I most want you to check
**Money safety**
- Can the agent ever spend without a matching approval, above a cap, with a non-allowlisted provider or token, or twice for the same step?
- Can a concurrent request bypass the per-task or daily cap (race between the policy check and the ledger write)?
- Is a payment ever marked `settled` without a transaction hash? Is a failed provider call ever counted as spend, or an uncertain one ignored?
- On mainnet, can anyone other than a paying customer or an admin trigger spend? Check `/api/approve` and `/api/run/*`.
- The customer payment is settled by x402 *after* the handler returns. What happens if the handler succeeds but settlement fails, or the agent spends but the customer never pays? Is that exposure bounded?
- Do the policy caps use the same units as the token (6 decimals)? Any bigint/number mixing?

**Security**
- Injection: shell (the `buy` CLI is spawned with `execFile`, no shell, confirm), SQL, HTML/XSS in `page.ts` (data from providers and LLM text is rendered), prompt injection via provider data into the report writer.
- Secrets: anything that could log or return a key, the facilitator key, or the DeepSeek key.
- SSRF or open-proxy risk from any user-controlled URL.
- Rate limiting and abuse: unauthenticated `/api/plan` calls the catalog and the LLM.

**Correctness**
- Does the x402 dynamic price work per plan, and can a plan be paid for twice or reused after completion?
- Catalog price tiers (`maxResults`) versus the price actually charged.
- Error handling around `JSON.parse`, timeouts, and the `buy` CLI exiting 0 with an error body.

**Tests**
- List important behaviours with no tests. Propose (do not yet write) the 5 most valuable tests.

## How to run and verify
```
pnpm install
pnpm typecheck
pnpm test
pnpm dev          # http://localhost:8787 (testnet, uses test funds)
```
`pnpm pay:test` (with `pnpm dev` running) plays a customer paying on Celo Sepolia. `docs/GUIDE.md` explains the full flow.

## Report format
Return a table: **Severity** (critical, high, medium, low) | **File:line** | **Problem** | **Concrete failure scenario** | **Minimal fix**. Order by severity. Then a short list of "verified OK" items and "could not verify" items. Stop and wait for my approval before changing code.
