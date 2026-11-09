# cPilot submission draft (not submitted)

This is a working draft only. It is not a Loops submission and is not evidence that a demo, independent user, payment, or service is currently available. Recheck event status and all linked evidence before using any submission form.

## Project summary

cPilot helps Nigerian online sellers and creators research public Instagram and TikTok content. It turns a question into a set of proposed paid services, obtains server confirmation of the selected sources and quote, requires explicit wallet approval, retrieves data through the Buy gateway, analyzes usable results, and produces a cited report with limitations.

## Data sourcing and report limits

All external social-data purchases are routed through `https://gateway.usebuy.ai`; provider names in catalogue entries do not authorize direct provider API calls. The data comes from third-party services, not official Instagram or TikTok APIs. cPilot does not access private accounts, messages, or actual sales, and the team has not verified how providers collect data.

Failed, unavailable, or unusable retrievals are not successful research results. TikTok's Top-content service is unfiltered by topic; do not describe it as matching a question's niche or use it to imply a topic-specific result. Report claims must be grounded in the actual purchased data and its fields.

## Payment disclosure

Incoming settlement is not independently verified against a successful Celo receipt, the expected USA₮ contract, payer, recipient, amount, and matching token `Transfer` event. The current app relies on facilitator-reported success and a transaction-hash-shaped value. The project must not claim independently verified settlement or guarantee that payment occurs only after delivery until this blocker is fixed and reviewed. Unresolved payments must not be retried.

## Evidence status

- The project-maintained [EVIDENCE.md](../EVIDENCE.md) records mainnet provider-purchase activity and a project-owner/team-wallet customer-payment test. This is team activity, not independent customer usage.
- The evidence log records no independent customer payment. Do not claim customer count, repeat use, revenue, or independent demand without new, permissioned evidence.
- The log includes user-research notes; confirm consent before naming any person in a public submission.
- The log contains transaction links and a demo URL from prior project records. This maintenance did not fetch those links or independently verify current deployment, receipts, contract, payer, amount, or event logs. Recheck them independently before making claims.
- Screenshots under `docs/screenshots/` are existing project assets, not current submission-ready evidence. The landing and plan captures contain superseded Lagos-specific suggestions and unsupported “pay only if the report is delivered” claims; the receipt capture shows facilitator/ledger settlement labels without independent on-chain verification. Keep these files unchanged, but do not present them as the current UI or verified payment evidence. Recapture only after the UI and payment disclosures are current, and independently verify any settlement evidence before using it. No demo video was verified in this maintenance.

## Submission fields to complete only after verification

| Field | Current status |
|---|---|
| Project name | cPilot |
| Repository | `https://github.com/jnationj/c-sme` (public status not rechecked live) |
| Demo URL | A prior URL is recorded in EVIDENCE.md; current availability not checked |
| Target bounty | Build with buy is named as the draft's primary target; confirm current event rules |
| Agent identity | Prior project records report ERC-8004 agent ID 10040; not rechecked here |
| Agent wallet | Record the public address only after confirming the correct project wallet and consent to publish |
| Independent user/problem evidence | Missing |
| Independently verified settlement evidence | Missing for the current audit |
| Demo video | Not verified |

Do not submit this draft with placeholders or claims that have not been independently confirmed.
