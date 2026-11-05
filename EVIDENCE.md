# Evidence log

Real events only. Nothing here is simulated. Each entry says who said it, when, and how it was obtained.

## User research

### Jesam: AI-content creator (Instagram + TikTok) , 2026-11-05
Source: written reply to a direct message from the project owner (pasted into the project chat).
- Has her own crypto wallet; "familiar with the Web3 space".
- Open to a 10-minute walkthrough and to giving honest feedback after trying it.
- The three questions she wants answered:
  1. Which AI image/video generation tools are getting the most engagement on TikTok, and what content types perform best?
  2. Which creators in the AI transformation / before-and-after niche are gaining traction, and what strategies drive their growth?
  3. What hooks, formats and content ideas work best for smaller AI-focused accounts trying to grow reach?

Status: has NOT yet paid. Wallet independence (own prior Celo activity, not funded by us) is unconfirmed.

### Blessing: Instagram clothing seller, 2026-11-05
Source: written reply to a direct message from the project owner (pasted into the project chat).
- Said she is excited and that it could help her make more money with her business.
- Gave permission to use her name in the hackathon project.
- Wants a 10-minute call this week and offered to send 3 real business questions to test.
- Does NOT currently use a crypto wallet (no MetaMask/Trust Wallet); wants to be shown how to set one up on the call.

Status: has NOT yet paid. She has no existing wallet, so her wallet will be new. That probably does not meet the "own prior Celo activity" independence rule; treat her as qualitative user feedback, not scored settlement evidence, unless the organisers say otherwise.

## On-chain
- 2026-11-04: Celo Sepolia x402 test settlement (test buyer -> project wallet, 0.02 USDC): `0x916c7508c402562747e3de7ea7e3ac0e74a2f224041e59427f0ead03d5d6e7a8`. Testnet only, not scored.

## On-chain: Celo mainnet (real money), 2026-11-05
All sent from the agent wallet `0x8c3c14616972cC3B06d4E378D5e11a682fC49e35`.

| What | Transaction | Notes |
|---|---|---|
| ERC-8004 identity registered | [0xaef63794f8…](https://celoscan.io/tx/0xaef63794f8280a66822cbe42c9ef0237e24cfde1b9f6f5e237e4d9340405076c) | Agent ID **10040**, owned by the agent wallet. Verified with `@celo/attribution-tags` `verifyTx`: carries code `celo_d0da34839ac6` (schema 0). |
| Registration file updated with the agent ID | [0xd51dd131a7…](https://celoscan.io/tx/0xd51dd131a77badda3302b691f10ff6713144f41e342b3699a1b477f4df51d90a) | `setAgentURI`, also tagged. |
| Data purchase S1: TikHub, trending hashtags | [0xdb81736b3b…](https://celoscan.io/tx/0xdb81736b3be1215c6f0eb531d1412d51f950fc4dcacb38d0b523f387f2fd1d39) | $0.005 USA₮, paid by direct x402 client |
| Data purchase S2: TikHub, top content | [0x11994aa3cb…](https://celoscan.io/tx/0x11994aa3cb9a4e75215624ff770b15461cc1759fbd077c149b367cfd9dcec463) | $0.005 USA₮ |
| Data purchase S3: Apify, TikTok video scraper | [0x16450a6f84…](https://celoscan.io/tx/0x16450a6f8440abc70c23cd69107824c5b2eb0c34252a97dc3f70bc7b9963046b) | $0.009 USA₮ |
| Probe: TikHub trending hashtags for Nigeria | [0xb65255a366…](https://celoscan.io/tx/0xb65255a36669b1017419ac01d0d64bc9ea2dd2b99c3759c7585db1585c509706) | $0.005 USA₮. Returned **zero items**: this source has no Nigeria data. |

Important limits of this evidence:
- The three data purchases are an **operator smoke test** (one report, run locally by the project owner with the agent wallet). They are **not customer payments**.
- **No customer has paid on mainnet yet.** Customer counts in the product are zero until that happens.
- The report from this run is saved in `docs/examples/first-mainnet-report.md`.

## Live site, customer-payment flow on Celo mainnet (team wallet), 2026-11-05
A full end-to-end run on the live site, https://c-sme-production.up.railway.app, receipt page: [/r/1ea7216d-07cd-4246-9d4d-822a844532fc](https://c-sme-production.up.railway.app/r/1ea7216d-07cd-4246-9d4d-822a844532fc).

| Step | Transaction | What happened |
|---|---|---|
| Funding of the test customer wallet | [0x88ad2b7fa8…](https://celoscan.io/tx/0x88ad2b7fa8cd68bfeb90bcfe45f5e175524d5fa48721e85afa7637a5dd00c80b) | Agent wallet sent $0.05 USA₮ to the project owner's own wallet `0x7216…bfCc` so it could act as a test customer. |
| **Customer payment (settled)** | [0x95a8b13048…](https://celoscan.io/tx/0x95a8b130481e9328b2b2513371cfb605b0407db457ffe2dbe41dd791ab1a9c1a) | `0x7216…bfCc` paid $0.039 USA₮ to the agent wallet through Celo's x402 facilitator. |
| Data purchase S1 (TikHub) | [0x9f97b99f41…](https://celoscan.io/tx/0x9f97b99f4185e772af6788d09afa6a7e6dd5f9ae576f870b0d743f33b2ac73ae) | $0.005 |
| Data purchase S2 (TikHub) | [0x443135735c…](https://celoscan.io/tx/0x443135735c1369ebdf8fed9b8ad5e8313e672355f95d2e2d8144c08425a10e16) | $0.005 |
| Data purchase S3 (Apify) | [0xc2dcb8632f…](https://celoscan.io/tx/0xc2dcb8632fd5040f15c45532926154412fb580862398db65560d9e880ff5122b) | $0.009 |

All five were verified on-chain (status success; amounts and addresses as listed). The customer paid $0.039; the agent paid $0.019 for data; the $0.020 difference is the service fee.

**This is a team test, not independent usage.** The paying wallet belongs to the project owner and was funded by the agent wallet. The live "Live proof" panel counts it under "team test reports", not under customers, and the site's customer counts remain zero until someone outside the team pays.

### Things that went wrong during testing (kept here for honesty)
- **Self-payment refused.** The agent wallet tried to pay its own site as a customer. The facilitator refused: "The payer and the recipient are the same address… refused before it reached the chain, so nothing was spent." No customer money moved, but the agent had already bought $0.019 of data. The site now rejects a self-payment before buying anything.
- **An earlier test run** (about 13 minutes before) also bought $0.019 of data whose customer payment did not settle. The project owner confirmed that was their own test. The same up-front check now prevents that case.
- **Sandbox allowance.** The buy gateway's test sandbox limits each paying address per day, which is why the live demo runs on mainnet.
