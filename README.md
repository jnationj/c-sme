# c-sme (CorridorPilot)

An agent for Nigerian small businesses. The owner asks a research question (for example, what competing tailors in Lekki charge). The agent finds the right paid data source in the live [buy](https://usebuy.ai) catalog, shows the exact price, waits for approval, pays over x402 on Celo, and returns a short report. The owner pays for the report in USA₮ through the Celo x402 facilitator.

Built for the Agents on Open Rails hackathon (Celo mainnet only for scored activity).

> **Status:** early scaffold. Real mainnet activity, independent users and evidence will be listed in `EVIDENCE.md` as they happen. Nothing here is simulated evidence.

## Principles

- The LLM plans and explains. A deterministic policy engine (`src/policy`) authorises every payment: caps, provider/token allowlists, explicit approval, idempotency, kill switch.
- Every economic action is written to an audit ledger (`src/ledger`).
- All direct transactions go through one wallet client (`src/chain/wallet.ts`) that adds the entry's ERC-8021 attribution tag.
- Secrets stay in `.env` (gitignored). Nothing client-side ever sees a key.
- No uncertain payment is retried until it has been reconciled on-chain.

## Setup

Requires Node 22.13+ and pnpm.

```powershell
pnpm install
copy .env.example .env      # then fill in values
pnpm wallet:new             # creates the agent wallet locally, prints only the public address
pnpm typecheck
pnpm test
pnpm dev                    # http://localhost:8787/health
```

Testing happens on Celo Sepolia with USDC (`X402_NETWORK=testnet`). Qualifying activity is on Celo mainnet with USA₮ (`X402_NETWORK=mainnet`).

## Credits

Patterns referenced (not copied) from MIT-licensed [GigaHierz/agent-on-trial](https://github.com/GigaHierz/agent-on-trial) and the official Celo docs. See `docs/` for architecture notes.
