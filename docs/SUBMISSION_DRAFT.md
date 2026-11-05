# Submission draft (nothing here is submitted; the owner approves every word)

Rules for this text: only claims that are true on the day of submission. Items in [BRACKETS] must be replaced with real evidence or deleted. No invented users, volumes or transactions.

## Fields

| Field | Value |
|---|---|
| Project name | CorridorPilot |
| Repo | https://github.com/jnationj/c-sme |
| Demo URL | [Railway URL, after deploy] |
| Agent wallet | 0x8c3c14616972cC3B06d4E378D5e11a682fC49e35 (already saved on the Loops entry) |
| Screenshots | [see "Screenshot plan" below] |
| Video | optional |

## Tagline
An agent that does paid market research for Instagram and TikTok sellers: it shows the exact price first and pays only after you approve.

## Description (draft)

**Who it is for.** Small online sellers and creators in Nigeria who sell and grow on Instagram and TikTok, for example a clothing seller in Lagos and an AI-content creator. [Blessing, clothing seller: gave permission to use her name. Jesam, AI-content creator: confirm permission before naming.] Today they guess what to post and what competitors do, or spend hours scrolling.

**What it does.** The owner asks a question, such as "what hooks and formats work for small AI-focused TikTok accounts?". The agent finds paid data sources in the live buy catalog, shows each exact price and the total, and waits. After the customer approves and pays from their own wallet, the agent buys the data over x402 on Celo and writes a short report that also states what the data cannot answer. If no data can be bought, the customer is not charged.

**How money moves.**
1. The customer pays our agent wallet (data cost plus a $0.02 service fee) in USA₮ through Celo's x402 facilitator. The payment is a gasless signature, so the customer needs no CELO.
2. The agent pays each data provider per call over x402 from the same agent wallet, under hard limits: per call, per task and per day caps, allowlists for providers and tokens, a kill switch, no spending while an earlier payment is uncertain, and no duplicate payments.
3. Every payment is written to an audit ledger. Each report has a shareable receipt with the transaction links.

**Autonomy and guardrails.** A language model plans explanations and writes the report, but a deterministic policy engine, not the model, decides every payment. The agent never spends without a matching approval. Failed provider calls are recorded as not charged and never counted as delivered.

**Celo stack used.** x402 via Celo's facilitator (customer payments and provider payments), USA₮ for settlement on mainnet, ERC-8004 agent identity [registered: agentId N, tx hash], ERC-8021 attribution tag `celo_d0da34839ac6` on directly sent transactions, and the buy catalog as the data marketplace.

**Honest status.** [Replace with facts on submission day: how many real customer payments settled on mainnet, from how many distinct wallets, how many repeat. If none are independent, say so plainly.] Known limits: Instagram data usually does not include prices ("DM for price"), so the agent says so and reports engagement and activity instead; some provider calls fail and are not charged; TikTok trend data is US-weighted.

## Tracks to enter (owner confirms after the organisers reply)
- Build with buy: the project consumes paid x402 services it does not own.
- Open Corridors, USA₮ with x402: customers settle in USA₮ through Celo's facilitator.
- Not entering Textile FX [unless Textile responds and we build it] and not entering LatAm.

## Screenshot plan (real captures only)
1. Plan screen: sources, prices, data + fee, "You pay".
2. Report screen with the payment table.
3. Receipt page with transaction links.
4. Customer activity and ledger.
5. Loops page showing the agent wallet, tag seen and ERC-8004 identity.
Capture the mainnet badge ("Celo mainnet (real money)") once real runs exist, and the Sepolia badge for staging shots. Never present Sepolia activity as mainnet.

## Evidence to collect before submitting (goes in EVIDENCE.md)
- Mainnet transaction hashes: first tagged transaction, ERC-8004 registration, each customer payment, each provider payment.
- Customer names only with permission, and what each said.
- The organisers' written answers to the scoring questions.
