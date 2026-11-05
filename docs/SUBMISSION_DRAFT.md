# Submission draft (nothing here is submitted; the owner approves every word)

Rules for this text: only claims that are true on the day of submission. Items in [BRACKETS] must be replaced with real evidence or deleted. No invented users, volumes or transactions. Screenshots in `docs/screenshots` are Celo Sepolia test mode and must never be presented as mainnet.

## Strategy (decided 2026-11-05)
1. **Primary track: Build with buy** (5 winners of $200). Judges look for: a named user and a real problem (40%), depth of paid-service integration measured by verified paid calls from the agent wallet (35%), and demand created for the services consumed (25%). The organisers said: "state what services you are using and proof of payments in your submission. No attribution tag needed." (Telegram #3310)
2. **Secondary: Open Corridors, USA₮ with x402.** Only enter it with honest evidence of who paid. Scored on settlement through Celo's facilitator, a named outside counterparty, repeat flow, and why USA₮ fits.
3. Not entering Textile FX or LatAm.

## Fields

| Field | Value |
|---|---|
| Project name | CorridorPilot |
| Repo | https://github.com/jnationj/c-sme (public; a fresh clone installs, builds and passes 34 tests) |
| Demo URL | [Railway URL after deploy] |
| Agent wallet | 0x8c3c14616972cC3B06d4E378D5e11a682fC49e35 (already saved on the Loops entry) |
| Screenshots | docs/screenshots (re-take on mainnet after the first real run) |
| Video | optional |

## Tagline
An agent that buys the market data a small seller or creator needs, shows every price first, and pays only after you approve.

## Description (draft, written to the Build with buy criteria)

**Who it is for.** Small online sellers and creators in Nigeria who grow on Instagram and TikTok: [Blessing, an Instagram clothing seller (gave permission to use her name)] and [Jesam, an AI-content creator on Instagram and TikTok (confirm permission before naming)]. Today they guess what to post and what competitors do, or spend hours scrolling.

**What it costs them now and what changed.** [Fill from real conversations: how long they spend today, what they pay, what the report replaced. Do not estimate.] The agent turns a plain-language question into a short report in about a minute, for cents.

**How it uses paid services (the core of the product).** Every report is built from paid x402 calls to services we do not own, bought through the buy catalog (gateway.usebuy.ai) with our agent wallet. The agent chooses sources from the live catalog, shows each exact price, waits for approval, then pays per call on Celo mainnet. A policy engine, not the AI, authorises every payment (per-call, per-task and daily caps, provider and token allowlists, duplicate-payment protection, a kill switch, and a hold while any payment is uncertain).

**Services consumed (with proof of payments).** Fill the transaction column from the ledger after the mainnet runs. Do not list a service we have not paid for.

| Service (buy catalog id) | Provider | Price | Used for | Mainnet proof |
|---|---|---|---|---|
| tiktok ads get-trends-hashtag-list | TikHub | $0.005 | trending hashtags | [tx hashes] |
| tiktok ads get-top-contents-list | TikHub | $0.005 | top-performing content | [tx hashes] |
| tiktok scraper (apidojo) | Apify | $0.009 per 10 results | recent videos for a keyword | [tx hashes] |
| instagram v1 fetch-search | TikHub | $0.005 | accounts matching a query | [tx hashes] |
| instagram v1 fetch-user-posts | TikHub | $0.005 | follow-up: recent posts of found accounts | [tx hashes] |
| instagram v2 fetch-hashtag-posts | TikHub | $0.007 | top posts for a hashtag (intermittent provider errors; failures are not charged) | [tx hashes] |

**Demand created for the services consumed.** [Replace with real numbers on submission day: paid calls bought, distinct providers, calls per customer report (3 to 5), customers who came back.] Each paid report buys 3 to 5 calls, so customer usage translates directly into new paid calls on these services. We do not claim volume we do not have.

**Why this instead of a general chatbot.** A chatbot answers from training data or the web pages it can open. We buy current TikTok and Instagram data per question from paid providers, show each price first, charge only if the report is delivered, and attach on-chain receipts to every report. We do not claim to be smarter or conversational. Full comparison: docs/HOW_IT_WORKS.md.

**Reliability and honesty.** Provider errors are recorded as "failed, not charged" and never counted as delivered. If no data can be bought, the customer is not charged. The report states what the data cannot answer: for example, Instagram usually does not expose prices ("DM for price"), and TikTok trend data is US-weighted.

**Celo stack used.** x402 via Celo's facilitator for customer payments (USA₮ on mainnet), x402 payments to buy-catalog services, ERC-8004 identity [registered: agentId N, tx hash], ERC-8021 attribution tag `celo_d0da34839ac6` on directly sent transactions (the facilitator does not tag x402 settlements yet, per the organisers; we declare our builder code in every 402 so tagging starts automatically when it ships).

**Honest status.** [Replace on submission day with facts: how many real customer payments settled on mainnet, from how many distinct wallets, how many repeat. If the pilot customers' wallets are new, say so plainly.]

## Open Corridors, USA₮ with x402 (secondary; enter only with evidence)
- Customers pay us in USA₮ through Celo's x402 facilitator. Receipts and the ledger show each settlement with its transaction link.
- Why USA₮ fits this user: a US-regulated dollar with stable pricing for sellers in a volatile-currency market.
- Named counterparties and repeat flow: [only list people who actually paid, with permission, and how many times].

## Evidence to collect before submitting (goes in EVIDENCE.md)
- Mainnet transaction hashes: ERC-8004 registration, first tagged transaction, each provider purchase, each customer payment.
- For each customer named: their words, date, permission, and each payment.
- The organisers' written answers (Telegram links) to any scoring question we relied on.

## Pre-submit checklist
- [ ] Agent wallet funded (USA₮ and CELO), mainnet smoke test passed
- [ ] ERC-8004 registered from the agent wallet; `AGENT_ID` set; Loops "identity" check green
- [ ] Tagged transaction visible; Loops "tag seen" check green
- [ ] Railway demo live on mainnet, `/health` ok, receipt page works
- [ ] At least one real customer run with transaction links in the Live proof panel
- [ ] Screenshots re-taken in mainnet mode
- [ ] README and this description match reality line by line
- [ ] Repo public and linked in the Loops submission (the AskBots review needs it)
