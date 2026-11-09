# cPilot owner guide

## What the product does

cPilot is a research tool for Nigerian online sellers and creators who use Instagram and TikTok. A user asks a question about public content. cPilot proposes paid data services from Buy, displays their current prices, gets the user's source selection confirmed by the server, waits for explicit wallet approval, retrieves the selected data through Buy, analyzes usable results, and returns a cited report.

cPilot reads public posts and accounts only. It cannot inspect private account data, messages, or actual business sales. Providers are third parties; the project has not verified their data-collection methods.

## Local checks and development

Requires Node.js 22.13+ and pnpm. Configure any needed environment values privately from the names in `.env.example`; do not commit a local environment file or paste secrets into chat or documentation.

```powershell
pnpm.cmd install
Copy-Item .env.example .env
# Configure local values privately. Keep local testing on the test network.
pnpm.cmd run typecheck
pnpm.cmd test
pnpm.cmd dev
```

The current scripts include `test`, `typecheck`, `dev`, `build:web`, `pay:test`, and wallet/registration utilities. Do not run payment, wallet, registration, or deployment utilities as part of ordinary local checks. The browser email-wallet bundle requires `VITE_PRIVY_APP_ID` to be supplied to the build process; `VITE_PRIVY_CLIENT_ID` is optional. If email-wallet configuration is absent, the injected browser-wallet option remains available.

For checks actually run during the current documentation cleanup, see [README.md](../README.md). Tests and typechecking are local software checks; they do not establish live service or settlement readiness.

## The user journey

1. Enter a question in the Ask form.
2. Review sources and their proposed prices.
3. Select or deselect sources. `/api/selection` revalidates the live Buy catalogue and returns the canonical selection and quote; the Pay action remains unavailable until confirmation succeeds.
4. Approve the confirmed quote in the wallet.
5. The backend retrieves the selected services through `https://gateway.usebuy.ai` only.
6. cPilot analyzes usable purchased data and returns a report with citations and limitations.

Services that are unavailable, fail, or return unusable data must not be described as successful purchases. A planned source is not proof of retrieval. TikTok's Top-content service has no topic filter, so its output is only a broad sample and cannot support a topic-specific conclusion.

## Payment-security blocker

Incoming customer settlement is **not independently verified** against a successful Celo transaction receipt, expected USA₮ contract, payer, recipient, amount, and matching token `Transfer` event. The current implementation relies on facilitator-reported success plus a transaction-hash-shaped value. Do not describe a receipt page or local ledger status as independent settlement proof or guarantee payment only after report delivery.

Do not retry unresolved payments. The project's [evidence log](../EVIDENCE.md) records a project-owner/team-wallet test and an earlier unsettled attempt. It does not establish independent customer usage. The local ledger is operational state, not independent on-chain evidence.

## Interpreting reports

- Check each citation and the corresponding purchased source.
- Treat missing fields as unavailable, not as zero.
- Check service geography and date coverage before applying a result locally.
- Treat TikTok Top-content results as unfiltered unless the actual service input demonstrates otherwise.
- Do not infer sales, private account activity, causality, or audience demographics from public-content data.

## Deployment

Deployment is not authorized by this guide. A production release should remain blocked until the incoming settlement-verification gap is fixed and reviewed, all current tests pass, and the actual deployment and evidence are checked without relying only on local ledger records. See [DEPLOY.md](DEPLOY.md) for the release limitation.
