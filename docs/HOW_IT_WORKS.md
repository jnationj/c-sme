# How CorridorPilot works, and why not just ask a chatbot

CorridorPilot answers one kind of question: **"what is working on Instagram or TikTok for people like me?"** It is built for Nigerian online sellers and creators. It is not a general assistant. This page explains exactly how a report is made, so you can judge it on evidence.

## From question to report, step by step

1. **You ask** in plain language. Example: "What hooks and formats work best for small AI content creators on TikTok?"
2. **The planner picks sources.** Plain code (not the AI) reads the question, pulls out the topic words, and chooses a handful of data sources from the live buy catalog (`gateway.usebuy.ai/v1/catalog`). It only uses sources that are live and priced right now. Typical picks: TikTok trending hashtags, TikTok top-performing content, a TikTok video search for your keywords, an Instagram account search, recent posts from the accounts it found.
3. **You see the exact price** of every source and the total (data cost + a small service fee) before anything is paid. Nothing is spent yet.
4. **You approve and pay** from your own wallet. Your payment is authorised but only settles after the report is delivered. If the agent cannot buy any data, you are not charged.
5. **A rules engine approves each purchase.** Before the agent pays a provider it checks hard limits: $0.05 per call, $0.25 per report, $1 per day, only approved providers and tokens, no duplicate payments, a kill switch, and a stop if an earlier payment is uncertain. The AI model cannot override these checks.
6. **The agent buys the data** by paying each provider per call over x402 on Celo. Each purchase is a real on-chain payment with a transaction hash.
7. **The report is written from the bought data only.** An AI model (DeepSeek, with a plain-list fallback) is instructed to use only the data provided, to avoid inventing numbers or creators, to suggest one concrete next action, and to **say what the data cannot answer**.
8. **You get a receipt page** for the report listing every data call with its transaction link, and the ledger records each payment.

If a data source fails, the failed call is recorded as "failed, not charged" and the run continues with the rest. A report is only delivered if at least one purchase settled.

## What the agent can and cannot see

| It can | It cannot |
|---|---|
| Recent public TikTok videos for a keyword, trending hashtags, top-performing ads/content | Your own account analytics or private data |
| Public Instagram accounts and posts matching a query, recent posts of those accounts | Prices that sellers keep in DMs ("DM for price") |
| Show you engagement signals that exist in the purchased data | Prove why a post performed well |

Known limits today: TikTok trend data is US-weighted, some provider calls fail intermittently, and reports are a few short bullets, not a long analysis.

## Why not just ask ChatGPT or Claude?

An honest comparison.

**Where a general chatbot is better.** It holds a conversation, remembers you, writes in your voice, handles any topic, and some can search the web inside the same chat. If you want brainstorming or editing, use one.

**What CorridorPilot does differently.**

| | General chatbot | CorridorPilot |
|---|---|---|
| Where facts come from | Training data, or web pages it can open | Data bought per question from paid TikTok and Instagram data providers |
| Evidence | Usually none you can check | Each report lists every data call with its on-chain transaction |
| Cost | Monthly subscription | A few cents per question, price shown first |
| Pays only on success | No | Yes: your payment settles only after the report is delivered |
| Admits gaps | Sometimes | Every report ends with what the data cannot answer |
| Spending control | Not applicable | Hard per-call, per-report and daily limits enforced in code |

**What we do not claim.** We are not smarter than a chatbot, not conversational, and we do not remember you. Our value is narrow: current platform data, bought on demand, with receipts and a price you agree to first. If that is not what you need, a chatbot is the better tool. We would rather say that than oversell.

## Where the money goes
- **Customer pays** data cost + $0.02 service fee (USA₮ on Celo mainnet, USDC on the Sepolia test network), through Celo's x402 facilitator. The fee covers report writing, hosting and payment settlement.
- **The agent pays providers** per call from its own wallet over x402 for services in the buy catalog.
- Receipts and the "Live proof" panel show real transaction links. In test mode the numbers come from the Sepolia test network and are labelled as such.
