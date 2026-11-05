# cPilot: how it works, how to run it, how to teach it

Plain-language guide for the project owner. Written so you can explain the product to a customer in five minutes.

## 1. The idea in one paragraph

A small-business owner or creator asks a research question ("what hooks work for small AI accounts on TikTok?"). An AI agent finds the right paid data sources in the live `buy` catalog, shows the **exact price** of each, and waits. The customer approves and pays **from their own wallet**. The agent then buys the data, and writes a short report that is explicit about what the data **cannot** answer. The customer is only charged if the report is delivered.

## 2. The money, step by step

```
Customer wallet --(1) pays data cost + our fee, signed from their wallet--> Our agent wallet (x402, USA₮ on mainnet)
Our agent wallet --(2) pays each data provider per call------------> buy gateway / data providers (x402)
Agent  -----------(3) DeepSeek writes the report from the data-----> Customer
```

- **Customer price = data cost + service fee** (fee is `REPORT_FEE_USD`, default $0.02). Example from a real Sepolia test: data $0.019 + fee $0.02 = customer paid $0.039.
- **How the customer pays:** the customer signs a payment authorisation from their own wallet and the Celo facilitator submits it. They hold USA₮ (mainnet) or test USDC (Sepolia).
- **Pay on success:** x402 settles after the report is produced. A failed run is not charged.
- **Safety rails the agent cannot override** (`src/policy`): per-call cap $0.05, per-task cap $0.25, daily cap $1, provider and token allowlists, kill switch (`KILL_SWITCH=1`), no spending while an earlier payment is uncertain, no duplicate payments.
- **Two stages:** some questions get a follow-up plan (for example, fetching a vendor's recent posts). It has its own price and its own approval.

## 3. Run it (Windows PowerShell)

```powershell
cd C:\Users\user\OneDrive\Documents\hackathon\celo1
pnpm dev          # builds the browser client, starts http://localhost:8787
```

Open http://localhost:8787. The badge shows the network:
- **Celo Sepolia (test money)**: safe practice mode. There is also a "Run with test funds" button.
- **Celo mainnet (real money)**: real USA₮. The free-run button is disabled; customers must pay.

Other commands: `pnpm test` (19 unit tests), `pnpm typecheck`, `pnpm pay:test` (a scripted customer pays for a plan on Sepolia; needs `pnpm dev` running).

## 4. What a customer does (your teaching script)

1. Open the link. Click **Connect wallet** (MetaMask on Celo; the page switches the network for them).
2. Type a question, or click an example. Click **Find sources and price**.
3. Read the plan: each source, its price, data total, fee, and **You pay**. Nothing has been charged yet.
4. Click **Pay with my wallet**. The wallet pops up asking for a **signature** (not a transaction). Approve.
5. Wait about 10 seconds per data call. The report appears with the payment table underneath.
6. If a follow-up plan appears, they can pay again for more detail, or ignore it.

**Good questions** (they match data we can actually buy):
- "Which hashtags and content types are trending for AI image and video tools on TikTok?"
- "What hooks, video formats and content ideas are working best for smaller AI-focused accounts?"
- "Who are the most active ankara tops sellers on Instagram in Lagos and what do their posts look like?"

**Questions the data cannot answer well** (be upfront with customers):
- Exact **prices** sellers charge on Instagram. Most say "DM for price". The report will say so.
- Anything about **your own** analytics or private accounts.
- Nigeria-specific trends: much of the TikTok trend data is US-based.

## 5. What to expect

| Event | What you see |
|---|---|
| Plan shown | 3 to 5 sources, each $0.005 to $0.009, plus fee |
| After paying | About 10s per call, then the report |
| A source fails | That call shows `failed (not charged)`; the run continues with the rest |
| Report text | 5 to 8 bullets, ending with what the data does NOT answer |
| Ledger | One row per payment, "paid" (to providers) and "received" (from customer) |

Honest limits: some provider calls fail (we are not charged and it shows); report quality depends on the data returned; the customer payment shows as `submitted` in the ledger until the settlement is confirmed.

## 6. Switching to mainnet (needs the owner's approval each step)

Checklist, in order. Do not skip steps:
1. **Fund the agent wallet** `0x8c3c14616972cC3B06d4E378D5e11a682fC49e35` with USA₮ and about 0.1 CELO.
   - Bybit (or any exchange): confirm USA₮ withdrawal on the **Celo** network is supported before sending. Wrong network can lose funds.
   - Token contract: `0xD2ab3C9A02DBBAB236BfEC45D1d755DF4267F771`. Check the contract in the exchange before sending.
   - Send **$1 first** as a test. Confirm it arrives on celoscan.io. Then send the rest ($2 to $5 total is enough).
2. Ask Claude to check the balance (read-only, public address).
3. Approve: import the agent key into `buy`'s mainnet account, then set `X402_NETWORK=mainnet` in `.env`.
4. Approve the first real paid run (one plan, exact amounts shown).
5. Register the ERC-8004 identity from the agent wallet (needs CELO gas; approve first).

## 7. Files that matter

| File | What it does |
|---|---|
| `src/policy/engine.ts` | The rules that decide if the agent may spend |
| `src/ledger/ledger.ts` | Audit log and payment records (SQLite, `data/ledger.db`) |
| `src/agent/planner.ts` | Turns a question into a priced plan from the live catalog |
| `src/agent/buyClient.ts` | Pays providers through the `buy` CLI |
| `src/agent/orchestrator.ts` | Plan, approve, policy check, pay, report, follow-up |
| `src/agent/report.ts` | DeepSeek (or Claude) writes the report; honest fallback |
| `src/seller/x402.ts` | Our paywall: customer pays data cost + fee |
| `src/web/page.ts`, `src/web/client.ts` | The page and the browser wallet client |
| `EVIDENCE.md` | Real events only: user feedback and transactions |

## 8. Secrets

`.env` holds the agent private key, the facilitator key, and the DeepSeek key. It is gitignored, but your project folder is inside OneDrive, which syncs it to the cloud. Consider moving the project outside OneDrive before mainnet. Never paste keys into chat, email or screenshots.
