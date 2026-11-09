# cPilot

cPilot helps Nigerian online sellers and creators research public Instagram and TikTok content. A user asks a question about a niche; cPilot finds relevant paid data services, shows the proposed sources and price, then waits for explicit wallet approval. It retrieves data through the Buy gateway, computes supported metrics, and returns a cited report with limitations.

Data is sold by third-party providers through [Buy](https://usebuy.ai), not fetched from TikTok's or Instagram's own APIs. cPilot reads public posts and accounts only. It cannot see private account data or actual business sales, and the project has not verified how providers collect their data. See [How cPilot works](docs/HOW_IT_WORKS.md).

## Status and evidence

The codebase includes the planner, live Buy catalogue integration, server-confirmed source selection, wallet flows, analysis/reporting, and Celo x402 payment paths. The current project evidence documents a project-owner/team-wallet test and provider-purchase records. It does **not** document independent customer activity. See [EVIDENCE.md](EVIDENCE.md); this project-maintained log is not a substitute for independently checking chain receipts.

**Payment-security limitation:** incoming customer settlement is not independently verified against a successful Celo receipt, the expected USA₮ contract, payer, recipient, amount, and matching token `Transfer` event. The application currently relies on facilitator-reported success and a transaction-hash-shaped value. Therefore, a displayed receipt or local ledger status is not independent proof of settlement, and cPilot does not promise a verified pay-only-on-delivery guarantee. Unresolved payments must not be retried.

## Research and payment flow

1. The user submits a question (maximum 500 characters).
2. The deterministic planner selects candidate services from the live Buy catalogue.
3. The user reviews and changes source selection. The server revalidates service availability, price, provider, gateway URL, and captured input schema, then returns the canonical selection and quote.
4. The user explicitly approves the confirmed quote in a wallet.
5. The backend retrieves selected services through `https://gateway.usebuy.ai` only. It does not call TikTok, Instagram, Apify, TikHub, or other providers directly.
6. Usable purchased results are analyzed and cited in the report. Failed, unavailable, or unusable retrievals are not presented as successful research purchases.

The TikTok Top-content catalogue service is unfiltered by topic. Its output must be described as a broad sample, not as content matching the user's topic. The report should not use it to imply topic-specific findings unless the actual service input supports that filter.

## Local development

Requires Node.js 22.13+ and pnpm. Use a local environment file based on `.env.example`; do not commit secrets or put their values in documentation, screenshots, or chat. Environment variable names used by the app include `ADMIN_TOKEN`, `AGENT_ID`, `AGENT_PRIVATE_KEY`, `ANTHROPIC_API_KEY`, `ATTRIBUTION_TAG`, `BASE_URL`, `BUY_ACCOUNT`, `BUYER_PRIVATE_KEY`, `CELO_RPC_URL`, `DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL`, `DEEPSEEK_MODEL`, `KILL_SWITCH`, `LEDGER_PATH`, `MAX_UNSETTLED_RUNS`, `NODE_ENV`, `PAY_BACKEND`, `PAY_PRIVATE_KEY`, `POLICY_DAILY_USD`, `POLICY_PER_CALL_USD`, `POLICY_PER_TASK_USD`, `PORT`, `PUBLIC_URL`, `QUESTION`, `RATE_*`, `REPORT_FEE_USD`, `REPO_URL`, `SELLER_PAY_TO`, `TEAM_WALLETS`, `VITE_PRIVY_APP_ID`, `VITE_PRIVY_CLIENT_ID`, and `X402_API_KEY` / `X402_NETWORK`.

```powershell
pnpm.cmd install
Copy-Item .env.example .env
# Configure local values privately; use the test network for local testing.
pnpm.cmd run typecheck
pnpm.cmd test
pnpm.cmd dev
```

The email wallet requires `VITE_PRIVY_APP_ID` at browser-bundle build time; `VITE_PRIVY_CLIENT_ID` is optional. The injected browser-wallet flow remains available. Do not use production funds or retry unresolved payments.

## Validation

On 2026-11-09, the focused release-maintenance checks completed as follows:

- `pnpm.cmd test` — 17 test files, 346 tests passed.
- `pnpm.cmd run typecheck` — passed.
- `git diff --check` — passed.
- Production build — not run; the existing build writes into the already-present ignored `web/` directory, which was left untouched.

These are local code checks only. They do not verify live Buy availability, provider data, payment settlement, deployment, or independent customer activity.

## Further documentation

- [How cPilot works](docs/HOW_IT_WORKS.md)
- [Owner's guide](docs/GUIDE.md)
- [Deployment notes](docs/DEPLOY.md)
- [Submission draft and evidence gaps](docs/SUBMISSION_DRAFT.md)
- [Project evidence log](EVIDENCE.md)

Patterns referenced (not copied) from MIT-licensed [GigaHierz/agent-on-trial](https://github.com/GigaHierz/agent-on-trial) and official Celo documentation.
