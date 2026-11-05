# How cPilot works, and why not just ask a chatbot

cPilot answers one kind of question: **"what is working on Instagram or TikTok for people like me?"** It is built for Nigerian online sellers and creators. It is not a general assistant. This page explains exactly how a report is made, so you can judge it on evidence.

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

## Where the data comes from (read this before relying on a report)

- **Sources:** third-party data providers, mainly **TikHub** and **Apify**, sold through the buy catalog (`gateway.usebuy.ai`). We pay them per call over x402.
- **Not official APIs.** The data does not come from TikTok's or Instagram's own APIs, and we do not use any customer's TikTok or Instagram login or account.
- **We have not verified how these providers collect their data.** Providers like these may gather public pages, which can raise questions under each platform's terms. We cannot vouch for their methods, so we describe the result only as "data about public content from third-party providers".
- **What we do with it:** read patterns (counts, medians, top posts) and cite each one. We keep the raw response of each purchase on our server so a report can be re-checked. Reports may quote public posts and account names that appear in the data.

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

**What cPilot does differently.**

| | General chatbot | cPilot |
|---|---|---|
| Where facts come from | Training data, or web pages it can open | Data about public TikTok and Instagram content, bought per question from third-party providers |
| Evidence | Usually none you can check | Each report lists every data call with its on-chain transaction |
| Cost | Monthly subscription | A few cents per question, price shown first |
| Pays only on success | No | Yes: your payment settles only after the report is delivered |
| Admits gaps | Sometimes | Every report ends with what the data cannot answer |
| Spending control | Not applicable | Hard per-call, per-report and daily limits enforced in code |

**What we do not claim.** We are not smarter than a chatbot, not conversational, and we do not remember you. Our value is narrow: current platform data, bought on demand, with receipts and a price you agree to first. If that is not what you need, a chatbot is the better tool. We would rather say that than oversell.

## Why not do this by hand?

You can, and for a one-off question it is free. This is what we know about the free options (not re-checked against each platform's current rules, so verify before relying on it):

| Free option | What it gives you | Limits |
|---|---|---|
| TikTok Creative Center (public website) | Trending hashtags, top-performing ads, top creators, with region filters | Fixed views only, no custom questions. Check whether your country is listed. |
| TikTok and Instagram search, hashtag and Explore pages | The actual posts with their likes and views | You scroll and note things yourself. Instagram needs a login and shows only a slice. |
| Your own account's Insights (professional accounts) | Your own audience and post performance | Your own data only, never a competitor's |

**What costs you time by hand:** reading dozens of posts, counting which hooks repeat, comparing several accounts, and keeping track of where each claim came from. **What cPilot adds:** it does the reading and counting in about a minute, cites every claim to a purchased source, and tells you what the data cannot answer.

**What it does not add:** access to anything you could not see yourself in the apps. If you have a free hour and want to learn the platform, doing it by hand is a good way to start. cPilot is for people who would rather have the answer and the receipts.

## Where the money goes
- **Customer pays** data cost + $0.02 service fee (USA₮ on Celo mainnet, USDC on the Sepolia test network), through Celo's x402 facilitator. The fee covers report writing, hosting and payment settlement.
- **The agent pays providers** per call from its own wallet over x402 for services in the buy catalog.
- Receipts and the "Live proof" panel show real transaction links. In test mode the numbers come from the Sepolia test network and are labelled as such.
