# Hackathon intelligence (from the official Telegram group, read 2026-11-05)

Source: read-only export of t.me/realworldagentshackathon via the tg-researcher tool (2,646 stored messages). Every statement below links to the original message. Organiser statements are authoritative; participant messages are only evidence. This is a snapshot: re-check before relying on a rule.

Base link format: `https://t.me/realworldagentshackathon/<id>`

## Confirmed by organisers for Agents on Open Rails

| Topic | What was said | Source |
|---|---|---|
| x402 credit | "For all x402 txs, we need your payto wallet address. Attribution tags are not yet supported by x402." Judges credit by **payTo address**. (Lena H) | #3310, #3255 |
| Facilitator tagging | Not live. Fix is under review upstream (x402-rs#99), tested on Celo Sepolia. Until it ships, settlements are untagged. Teams can already declare their builder code in the 402 response (`extensions["builder-code"].info.a`, v2 only, USDC/USDT/USAT first). We added this. | #3255 |
| Paying other services (Build with buy) | "For buy the main focus is to build a good agent using the services. Please state what services you are using and proof of payments in your submission. **No attribution tag needed** here." | #3310 |
| Third-party facilitators | The USA₮ subtrack is "settling USA₮ through Celo's x402 facilitator"; third-party facilitators would not count there. We use Celo's. | #3492 |
| Textile FX scoring (by Textile) | Scored on **innovation first, then return**. Volume is not a criterion; tags and attribution do not matter. Maker fills are verified on-chain by wallet. Send Textile a short write-up, fill hashes and P&L. No deadline from Textile. (Benoit N, Textile co-founder) | #3504 |
| Disclosed private demos | A demo on the team's own funds with small real trades is fine if disclosed clearly (whose funds, how much). Track everyone who actually uses the demo: wallets created, first transactions, testers walked through it. "Useful evidence even if they're new to Celo." (Defi Messiah) | #3478 |
| Self / USA₮ faucet | NFC-chip passports and ID cards only (Aadhaar not accepted). Claim $0.50 USA₮; +$0.20 for sending to another Celo wallet (24-48h); +$0.30 for holding 5+ USA₮ for 10 days. | #3529 |
| Dates | Registration and submission close Mon 9 Nov 09:00 GMT; winners announced Fri 13 Nov. Office hours every Thursday 12:00 GMT (Google Meet link is posted in the group). | #3558, #3272 |
| AskBots review | A review bot opens a GitHub issue titled "AskBots review: Agents on Open Rails Hackathon feedback" on projects with a **public repo linked in the Loops submission**. Feedback only, not judged. | #3542 |
| Every team | 3 months of the Chainstack Growth Plan. | #3558 |

## From the PREVIOUS event (Agents at Work, closed 21 Sept). Use as a guide only: Lena said "the rules can change between events"

- A **user** is a wallet that sent or received a token in a tagged transaction or x402 settlement, or signed one. The team's own registered wallets are excluded. (#3128)
- A **verified** user also moved a token on Celo in the 60 days before 28 August (a window that ended before that event started). Wallets created during the event were "real users but not pre-existing ones", and independent volume for them was $0. (#3103, #2933)
- Only **token transfers** counted for the pre-existing test, not contract calls. (#2933)
- Value is measured on independent volume, so a team's own wallet interacting with itself scored zero. (#3104)

What this means for us: our pilot customers (Blessing, Jesam) will most likely count as users but may not count as verified or independent unless their wallets already moved a token on Celo before the event began. Read the live rules at https://www.loops.house/agents-on-open-rails. Open Rails scoring text may differ.

## Still unanswered (ask in office hours or the group)
1. Does a gasless x402 payer from a brand-new wallet count toward the USA₮ "named counterparty" and "repeat flow" criteria? (Likely counted as a user but not verified.)
2. Do Textile FX and USA₮ with x402 count as one track for the one-prize rule? Can one project enter USA₮ and Build with buy?
3. For the demo URL: does it need to work with real mainnet funds for judges, or can it be a guided demo? (A participant guessed "test end to end"; no organiser answer found.)

## Other useful facts
- Judges for Build with buy look at services used and proof of payments. Keep a list of the exact catalog endpoints and transaction hashes.
- cNGN and Ripio wFIAT tokens are now supported by the Celo x402 facilitator (#3509).
- Several teams report Textile maker fills cannot carry their tag; Textile says that is fine for its track (#3504).
- buy gateway route outages happen (a team saw a 404 on one route, #3443). Keep our fallback and failure handling.
