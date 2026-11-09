# How cPilot works

cPilot helps Nigerian online sellers and creators research public Instagram and TikTok content. It is a focused research tool, not a general assistant. It does not access private accounts, private messages, or a seller's actual sales.

## From question to cited report

1. **Ask.** The user writes a question in plain language.
2. **Discover.** A deterministic planner extracts the supported intent and proposes services using the live Buy catalogue at `https://gateway.usebuy.ai/v1/catalog`. No provider is called during planning.
3. **Review and select.** The user sees the proposed data sources and prices and can change the selection. The browser submits the selected service IDs to `/api/selection`. The server refreshes the catalogue and validates each service's availability, Buy gateway URL, method, provider, token, input schema, and current price. The server response is canonical; the browser uses its selected sources and quote.
4. **Approve.** The user must explicitly approve the server-confirmed quote in their wallet. A changed or unconfirmed selection cannot be paid. Empty selections are not purchasable.
5. **Retrieve.** The backend sends external data-purchase requests only through `https://gateway.usebuy.ai`. It does not call TikTok, Instagram, Apify, TikHub, or another data provider directly. Provider names in the catalogue describe the service, not an authorization to bypass Buy.
6. **Analyze.** Code computes supported counts, medians, hashtags, and other structured facts from usable purchased responses. Failed, unavailable, malformed, empty, or otherwise unusable responses are not described as successful research purchases. If no usable purchased data is returned, cPilot does not produce a research report.
7. **Report.** The report cites its purchased sources and describes relevant limitations. A service's presence in a plan is not evidence that it returned data.

## Important limits on findings

- TikTok's Top-content catalogue service does not accept a topic filter. It is a broad sample. Its results must not be described as topic-matched or used to imply that a finding applies to the user's niche.
- The providers are third parties. cPilot has not verified how they collect their data or whether their collection methods comply with each platform's terms.
- The service sees only the public content returned by the purchased services. It cannot see private account data, private messages, actual business sales, or why a post performed well.
- Coverage and fields vary by service and response. Missing fields are not evidence of zero activity. Geography and date ranges are limited to what the selected service actually supports.

## Payment status and security limitation

The user sees the selected-source quote and must approve in a wallet. Provider purchases are made through Buy; a provider failure is not counted as a successful data result. If the provider-payment outcome is uncertain, the agent stops further spending rather than retrying automatically.

Incoming customer settlement has a known verification gap. The application currently accepts facilitator-reported success plus a transaction-hash-shaped value as settled; it does **not** independently verify a successful Celo receipt, the expected USA₮ contract, payer, recipient, amount, or matching USA₮ `Transfer` event. A local ledger status or receipt link is not independent proof of those facts. The project therefore cannot promise that payment is independently verified or guaranteed to occur only after a report is delivered. An unresolved payment must not be retried.

The project-maintained [evidence log](../EVIDENCE.md) records a team-wallet test and earlier payment issues. It does not document independent customer activity. Historical entries and linked transactions were not re-verified as part of this documentation update.

## Where data comes from

The purchased inputs are third-party services listed by Buy (including services identified in the catalogue as TikHub or Apify). They are not TikTok's or Instagram's official APIs. cPilot does not use a customer's social-media login. The project has not independently assessed provider collection practices.

## Validation and non-claims

Local test and typecheck results are recorded in the root [README](../README.md). Those checks do not prove live catalogue availability, provider data retrieval, successful on-chain settlement, deployment health, or independent customer use. cPilot does not claim to be more capable than a general chatbot; its purpose is to purchase selected public-content data, summarize what was returned, and show its sources and limitations.
