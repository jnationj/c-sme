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
