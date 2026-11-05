# Deploying cPilot (public demo URL)

## Why not Vercel as-is
Vercel runs short-lived serverless functions with no persistent disk. This app keeps state in memory (open plans) and in a local SQLite file (ledger, receipts, customer stats), and one paid run takes 20 to 60 seconds. On serverless, plans would vanish between requests and the ledger would reset. Making it work would mean moving state to an external database (a rewrite), which we should not do this close to the deadline.

Use a host that runs a long-lived container with a persistent volume: **Railway**, **Render** or **Fly.io**. Check each host's current free tier and pricing yourself; I have not verified them.

## What every host needs
- Build from the repo's `Dockerfile` (Node 24). Port: the host's `PORT` variable is respected (default 8787).
- A **persistent volume mounted at `/app/data`** (holds `ledger.db`). Without it, receipts and the ledger vanish on every redeploy.
- HTTPS (all three provide it). MetaMask signing needs it.

## Environment variables (set in the host dashboard, never in the repo or in chat)

| Variable | Staging (testnet) | Production (mainnet) |
|---|---|---|
| `X402_NETWORK` | `testnet` | `mainnet` |
| `PAY_BACKEND` | `direct` (already the Docker default) | `direct` |
| `PAY_PRIVATE_KEY` | the throwaway test buyer key (Sepolia only) | leave unset |
| `AGENT_PRIVATE_KEY` | unset | agent wallet key (the hot wallet; keep only a few dollars in it) |
| `SELLER_PAY_TO` | agent wallet address | agent wallet address |
| `X402_API_KEY` | facilitator key | facilitator key |
| `DEEPSEEK_API_KEY` | your key | your key |
| `ATTRIBUTION_TAG` | `celo_d0da34839ac6` | `celo_d0da34839ac6` |
| `PUBLIC_URL` | the host's URL | the host's URL |
| `POLICY_PER_CALL_USD` / `POLICY_PER_TASK_USD` / `POLICY_DAILY_USD` | `0.05` / `0.25` / `1.00` | same, or lower |
| `MAX_UNSETTLED_RUNS` | `3` | `3` |
| `REPORT_FEE_USD` | `0.02` | `0.02` |
| `ADMIN_TOKEN` | optional | leave unset (locks the operator endpoint) |

Do **not** set `.env` files on the host. Do not set `BUY_ACCOUNT`; the direct backend does not use the buy CLI.

## Steps (generic)
1. Create the project from the GitHub repo `jnationj/c-sme` (it is public).
2. Add the volume at `/app/data`.
3. Add the staging variables. Deploy.
4. Open the URL: the badge must say "Celo Sepolia (test money)". Run a question with **Run with test funds**, then try **Pay with my wallet** in MetaMask on Celo Sepolia.
5. Check `/health` and a `/r/<id>` receipt.
6. Only after the mainnet checklist in `docs/GUIDE.md` and the owner's approval: switch to the production variables and redeploy.

## Rollback
Set `X402_NETWORK=testnet` or `KILL_SWITCH=1` and redeploy. The kill switch blocks all agent spending.
