# Deployment notes

This document describes deployment considerations; it does not confirm that any hosted deployment is currently live or healthy. No deploy was performed for this maintenance.

## Release blocker

Do not treat the current application as payment-secure for production. Incoming settlement verification is not independently checked against all of:

- a successful Celo transaction receipt;
- the expected USA₮ token contract;
- the expected payer and configured recipient;
- the reviewed amount; and
- the matching USA₮ `Transfer` event.

The app currently relies on facilitator-reported success and a transaction-hash-shaped value. A local ledger status or explorer link alone does not close this gap. Do not promise independently verified settlement or “pay only when delivered.” Never retry an unresolved payment.

## Runtime requirements to assess before deployment

The app keeps proposed plans in process memory and uses SQLite for reports, receipts, and payment records. Any host selected for a future deployment must support a long-running Node.js process, persistent storage for the configured ledger path, HTTPS, and the request duration required for research runs. The current repository does not establish that a specific host is configured or available.

Relevant environment-variable names include `PORT`, `PUBLIC_URL`, `LEDGER_PATH`, `X402_NETWORK`, `PAY_BACKEND`, `SELLER_PAY_TO`, `X402_API_KEY`, `AGENT_PRIVATE_KEY`, `ATTRIBUTION_TAG`, `CELO_RPC_URL`, `DEEPSEEK_API_KEY`, `ANTHROPIC_API_KEY`, policy-limit variables, `MAX_UNSETTLED_RUNS`, and the optional `ADMIN_TOKEN`. Privy browser configuration uses `VITE_PRIVY_APP_ID` and optional `VITE_PRIVY_CLIENT_ID`. Keep values in the host's protected configuration or a local ignored environment file; never add them to the repository, screenshots, logs, or chat.

Do not set or copy production values based on this documentation. Confirm every variable's current use in code and have the owner review the configuration before any future deployment.

## Safe release sequence

1. Resolve the settlement-verification blocker and add focused tests before production use.
2. Triage the existing worktree and explicitly select only reviewed source, test, and documentation paths.
3. Run the repository's test suite and typecheck; review any generated build output before release.
4. Independently validate the deployment target, storage persistence, access controls, and runtime configuration.
5. Obtain separate authorization before any production deployment or payment-related activity.
