**AGENTS ON OPEN RAILS  \|  MASTER PROJECT BRIEF**

**AGENTS ON**  
**OPEN RAILS**

**MASTER PROJECT BRIEF & TEAM EXECUTION SPECIFICATION**

One integrated agent product • Three sponsor tracks • Celo mainnet

Prepared for: Joseph (Project Owner), ChatGPT (Technical Lead), Claude (Technical Development Lead), and GitHub Copilot (Second Developer)

Version 1.0  \|  4 November 2026  \|  Submission deadline: 9 November 2026, 09:00 GMT

Working document • 4 November 2026 • Verify live parameters before mainnet execution  
**AGENTS ON OPEN RAILS  \|  MASTER PROJECT BRIEF**

**Document purpose and status**

This is the shared source of truth for the team. It translates the Agents on Open Rails hackathon brief supplied by the project owner into product requirements, track-by-track acceptance criteria, technical architecture, implementation boundaries, testing, evidence and team workflow.

| Important status label This is a working project specification, not a claim that every integration has already been implemented or that all sponsor endpoints/markets are available to our wallet. Official documentation was checked on 4 November 2026\. Re-check live facilitator configuration, Textile corridor availability, sponsor attribution and the Loops dashboard before mainnet transactions. |
| :---- |

The project will target all three selected tracks: (1) Textile FX, (2) Build with buy, and (3) USA₮ with x402. The same product may serve all three, but each track must have its own demonstrable economic activity and evidence. Merely mentioning or importing a sponsor SDK does not qualify as meaningful integration.

**1\. Executive summary**

We will build one integrated autonomous treasury and procurement agent for a real business user. The working product concept is “CorridorPilot” (placeholder name; final naming is a product decision). It helps a small business manage currency conversion, obtain external information/services, and make verified dollar-denominated payments.

The intended user is a small business or independent operator that regularly needs to (a) manage local-currency and USD stablecoin exposure, (b) pay for external digital services or business data, and (c) pay independent suppliers or service providers in a predictable dollar stablecoin. The first pilot persona and actual counterparty must be named and validated before submission.

| Track / rail | Role in the product | What must actually happen |
| :---- | :---- | :---- |
| Textile FX | Treasury / market-making engine | Our quoting agent operates as a Textile filler on Celo mainnet, publishes firm quotes, and earns spread on genuine independent fills. It must have inventory, a reliable price feed, risk limits and a way to manage the counter-asset. |
| Build with buy | External service procurement | The agent discovers and purchases useful third-party APIs, data, browser/compute or inference through buy/x402. Calls must power a real user workflow, be paid from the tagged project wallet, and create demand for services we do not own. |
| USA₮ with x402 | Dollar payment / monetisation rail | The product accepts or makes real USA₮ x402 payments on Celo mainnet involving an independent counterparty, with repeat transactions and a clear user reason for USA₮. |

| Core product principle The three rails must cooperate at the product level, but do not assume they form one atomic swap/payment. Textile corridors named in the brief trade local stablecoins and USDC against USD₮. USA₮ is a separate x402 payment asset. Do not claim a direct Textile USD₮→USA₮ conversion unless a supported route is independently verified. |
| :---- |

Success is not “three logos on one dashboard.” Success is a real user completing a real business task while the agent uses each rail for a distinct, justified purpose.

**2\. Hackathon overview**

| Item | Requirement / information |
| :---- | :---- |
| Hackathon | Agents on Open Rails Hackathon — Loops House / Celo ecosystem |
| Theme | Agents that earn, pay and settle on live payment rails, with real money moving. |
| Submission deadline | Monday, 9 November 2026, 09:00 GMT (as stated in the hackathon page supplied by the owner). |
| Winner announcement | Friday, 13 November 2026 (as stated in the supplied page). |
| Prize pool | \$5,000 across the listed tracks. |
| Network | Celo mainnet for qualifying activity. Testnet activity is for development only and does not count as mainnet competition activity. |
| Identity | Register the project agent's ERC-8004 identity from the wallet that should own/control that identity. |
| Attribution | Enroll to obtain the entry attribution tag, and integrate the correct tag into supported mainnet transactions before the first qualifying transaction. |
| Track participation | The supplied FAQ says multiple tracks may be entered. Confirm the dashboard permits all three selected tracks and each submission is correctly associated. |

Hackathon rationale: autonomous agents need verifiable identity, the ability to pay and get paid without a human signing every step, and stablecoins that matter to the people and businesses using them. Celo supplies ERC-8004 identity, x402 payment infrastructure, local/global stablecoins and low-cost settlement.

**2.1 Selected tracks and prizes**

| Track | First place | Second place | Our qualifying outcome |
| :---- | :---- | :---- | :---- |
| Open Corridors: Textile FX | \$750 | \$250 | A live Celo-mainnet Textile filler/quoting strategy, scored on strategy P\&L (40%), quoted and filled volume (30%), originality (30%). |
| Build with buy | $1,000sharedacrossfivewinners($200 each) | — | A real product paying for third-party services it does not own over x402, scored on use-case quality (40%), integration depth (35%), demand created (25%). |
| Open Corridors: USA₮ with x402 | \$750 | \$250 | A product with real users settling USA₮ through Celo's x402 facilitator on mainnet, scored on real settlement (25%), named independent counterparty (25%), repeat flow (25%), and why USA₮ matters (25%). |

Maximum theoretical prize opportunity across these three tracks is \$2,500 if the project won first place in both \$750 tracks and one of the five \$200 Build with buy awards. This is an opportunity, not a forecast or guaranteed combined award.

**3\. Product concept and user journey**

**3.1 Working concept: CorridorPilot**

CorridorPilot is a treasury and procurement assistant for a small business with recurring cross-border or digital-service expenses. The user describes a business need, a budget, the preferred currency and the intended recipient. The agent gathers relevant information, compares available FX liquidity, prepares a controlled treasury action, purchases necessary external services, and pays an independent provider where appropriate.

The first use case must be narrowed to one named user/business and one recurring job. Candidate pilot: a small Nigerian business that needs to manage cNGN/USD₮ liquidity, purchase supplier or market intelligence, and pay an independent overseas digital supplier. This is a hypothesis to validate, not a claim that a specific business has agreed to participate.

**3.2 Example end-to-end journey**

A business user enters an expense or procurement task: what is needed, maximum budget, deadline, recipient, and currency preference.

The agent identifies the minimum external information required and checks the buy catalogue for an appropriate third-party service.

Before spending, the agent displays the service, exact price, payment asset, recipient/provider, and reason it is needed. It obtains the user's approval for the spending policy or the specific payment.

The buy integration pays for the selected third-party API/data/compute/inference call. The agent records the provider, paid-call receipt, transaction hash, result and business decision influenced by that result.

For local-currency treasury management, the Textile module monitors a configured corridor and runs its own maker/filler quoting strategy. It publishes quotes only while inventory, reference prices and risk limits are healthy.

When an independent trader takes a quote, the Textile settlement is recorded. The agent updates inventory, realised spread, P\&L, exposure and available capital.

For a service or supplier that accepts USA₮, the product presents an x402 payment request or paid endpoint. The independent payer signs the USA₮ authorisation and the Celo facilitator settles it on mainnet.

The dashboard shows the user what happened: service purchased, FX quote/fill, USA₮ payment, counterparties, receipts, onchain hashes and current risk/exposure.

| Do not fake the journey A simulated UI, internal test transfer, self-trade, repeated calls to the cheapest endpoint, or payments between team-controlled wallets are not substitutes for independent economic activity. The user workflow must be powered by the actual paid calls and settlements claimed. |
| :---- |

**4\. Track-specific requirements**

**4.1 Textile FX — autonomous filler / quoting strategy**

This track is not simply a swap aggregator or an app that asks Textile for quotes as a taker. The stated competition asks for a quoting strategy live on Textile FX on Celo mainnet. We therefore need to operate as a filler/market maker that answers traders' RFQs with firm prices and earns spread when those quotes fill.

Current Textile documentation describes the v2 RFQ API as the current integration surface; v1 is deprecated and should not be used for a new build. Stitch is Textile's open-source operator bot and is the best baseline to inspect before implementing custom market-making logic.

**Required capabilities**

A dedicated maker/filler wallet with controlled working inventory. Do not use a personal treasury wallet or expose a primary wallet key.

A corridor confirmed by Textile for Celo mainnet. The hackathon lists cNGN, wARS, wBRL, IDRX or USDC against USD₮; actual maker onboarding and live availability must be verified.

A reliable reference price feed with timestamp and stale/degraded detection. Prefer multiple sources or a documented fallback.

A quoting strategy that varies spread by inventory, volatility, liquidity, quote size, recent flow, adverse-selection risk and time since last trusted price.

Hard controls: maximum position, maximum order size, maximum daily loss, minimum spread, maximum quote age, maximum price deviation, kill switch and automatic quote suspension when data is stale.

A clear exit/hedge plan for the non-USD counter-asset. Textile documentation explicitly says the filler must arrange its own off-ramp or hedge.

An always-on process for live quoting during the competition window, with health checks, logs, alerting and restart behaviour.

P\&L reporting based on actual fills, including fees, inventory valuation, realised/unrealised P\&L and risk-adjusted performance.

**Textile RFQ integration facts**

Base API: https\://api.textilecredit.com/v2.

RFQ flow: preview (indicative only) → request firm quote → receive signed order(s) and swap calldata → broadcast the returned transactions.swap → submit transaction hash / monitor RFQ status.

A firm quote is bound to the named taker wallet and has an expiry. The API documentation currently describes a default 60-second quote TTL and up to approximately 750 ms maker reply budget, with cold-path token-decimal preflight potentially extending total request time; use the documented safe timeout rather than assuming sub-second end-to-end.

A firm quote may bundle several maker orders. Always execute the returned transactions.swap calldata; executing only the top-level first order can underfill a bundled quote.

The protocol fee on Celo is currently documented as 1 basis point. The filler's spread is embedded in the quoted rate.

No-quote is a normal market outcome, not necessarily an API failure. Implement reason-aware retry/backoff.

**Textile strategy differentiator**

A credible originality angle is an inventory-aware adaptive spread engine. Example decision inputs: inventory ratio against target, mid-price movement, feed confidence, recent fill direction, quote size, corridor depth, time since last fill, and expected hedge cost. The strategy should widen spreads when inventory is scarce or price confidence falls, and tighten spreads when inventory is abundant and market conditions are stable.

Keep the pricing formula deterministic and explainable. The LLM may explain a strategy decision or help an operator inspect anomalies, but it must not directly invent executable prices or override risk limits.

**Textile test / onboarding caveat**

The Textile docs list test environments and instruct prospective fillers to contact Textile for corridor API/contract addresses and test access. The public RFQ examples may show other chain IDs; do not copy them into Celo. Obtain written confirmation from Textile about the Celo mainnet maker onboarding, corridor configuration, testnet route, API key/attribution support and the correct way to credit our hackathon entry.

**Textile acceptance criteria**

The agent is visible/connected as a maker on a confirmed Celo mainnet corridor.

A custom quoting rule is implemented and documented in the repository.

Quotes are actually published and answered; independent traders can take them.

At least one genuine independent fill is captured if market conditions and capital permit; target repeat fills and meaningful volume rather than a one-off demonstration.

The system can stop quoting safely when a feed, wallet, inventory or risk condition fails.

A reproducible report shows quoted volume, fill volume, fill rate, spread, realised P\&L, mark-to-market exposure and risk controls.

**4.2 Build with buy — pay for services we do not own**

This track rewards a useful product whose agent pays for external services over x402. The product must solve a real task for a named user/business. The paid service calls must power the user-facing workflow and create new demand for the services consumed.

**Required capabilities**

Use the buy client / MCP skills or another supported x402 client to discover, price and pay for third-party services.

Read the live catalogue rather than hardcoding a stale list of providers or prices.

Select services based on the task; request/confirm the exact cost before paying.

Implement spend controls: per-call cap, per-task cap, daily cap, allowed provider/category list, approval policy and emergency stop.

Record the paid service name, provider, requested operation, quoted cost, payment asset, payer wallet, transaction/receipt, returned data and how the result affected the user's task.

Handle 402 responses, insufficient balance, rejected/expired payment authorisations, provider errors, duplicate retries and partial task failure safely.

Use real third-party services we do not control. Calls to our own API or a mock endpoint do not prove the required external demand.

The buy-skill repository recommends a gateway workflow that reads the live catalogue, quotes the exact request, gets user approval for that price, pays once, and reports the transaction hash. Its stated categories include social/flight data, browser sessions, GPU leases, Celo RPC and LLM inference. We should choose one or two services that directly support the selected business workflow, not integrate many services superficially.

**Build with buy acceptance criteria**

A named user can complete a real task from the app.

At least one external paid service is called through buy/x402 and its output is used in the result.

The paid call is made from the project-tagged wallet and is attributable according to the hackathon's current tracking rules.

The repository contains evidence of the real paid flow and explains why this provider was selected.

Independent users use the workflow; repeat use and new paid counterparties are stronger than a scripted demo.

**4.3 USA₮ with x402 — independent dollar settlement**

This track requires a product with real users settling USA₮ through Celo's x402 facilitator on Celo mainnet. The judging criteria are evenly weighted: real mainnet settlement, a named counterparty outside the team, repeat flow from that counterparty, and a convincing reason USA₮ is the right currency.

**Required capabilities**

A seller endpoint or payment flow that returns HTTP 402 with exact USA₮ payment requirements, or a buyer flow that pays a genuinely independent seller.

A real independent counterparty with a clear identity/role (person, business or agent) and a clear description of what they pay for.

Repeat payment activity from the same independent counterparty during the hackathon window.

Use the Celo mainnet facilitator endpoint https\://api.x402.celo.org for mainnet. The dashboard URL and payment API URL are not interchangeable.

Use the USA₮ token configuration from the live facilitator configuration / official USA₮ docs. The supplied hackathon page lists USA₮ at 0xD2ab3C9A02DBBAB236BfEC45D1d755DF4267F771 with 6 decimals and EIP-3009 domain name 'Tether America USD', version '1'; re-verify before deployment.

Keep the facilitator API key server-side. Never expose it in browser code or the public repository.

Verify the payment requirement, asset, amount, payTo address and settlement result. Confirm the onchain transaction before delivering anything valuable.

Explain why the user's workflow benefits from a US-regulated dollar settlement asset rather than using a generic stablecoin without justification.

**Development network facts**

Celo's current x402 documentation says Celo Sepolia (chain ID 11142220\) supports USDC only; USA₮ is supported on Celo mainnet (chain ID 42220). Therefore: test the x402 buyer/seller flow on Celo Sepolia using test USDC, then switch to USA₮ on mainnet for the qualifying track. A Sepolia USA₮ test is not available through the documented Celo facilitator.

**USA₮ acceptance criteria**

The live product completes USA₮ x402 settlement on Celo mainnet.

At least one independent payer/payee is named in the submission and is outside the team.

The same independent counterparty completes repeat payments, not just a single demo transaction.

The payment is for a real service/product action, with evidence of delivery.

The submission explains why USA₮ is appropriate for this specific user and workflow.

**5\. Shared product architecture**

The recommended architecture is a modular monolith or a small set of clearly separated services for the hackathon. Avoid premature microservices. Keep the three rail adapters isolated behind typed interfaces so each can be tested independently.

| Layer | Responsibilities | Key rule |
| :---- | :---- | :---- |
| User application | Business onboarding, task request, budgets, approvals, activity timeline, FX dashboard, payment receipts and risk status. | The user should not need to understand Celo, x402 or RFQ internals. |
| Agent orchestration | Task planning, tool selection, workflow state, policy checks and user-facing explanations. | LLM proposes; deterministic policy/risk layer authorises. |
| Policy & risk engine | Spend limits, approval gates, allowed counterparties, inventory limits, quote guardrails, idempotency and kill switches. | No agent action bypasses this layer. |
| Textile adapter | Filler connection, reference price, quote strategy, inventory, order lifecycle, fills and P\&L. | Keep maker private key and trading logic server-side. |
| Buy adapter | Catalogue lookup, price confirmation, x402 payment, external service invocation, receipt and result capture. | Pay only for a service used by a real task. |
| USA₮ x402 adapter | Paid endpoint / buyer flow, 402 requirements, wallet authorisation, facilitator verify/settle and receipt. | Never trust a client-side claim of payment; verify settlement. |
| Identity & attribution | ERC-8004 registration, project tag integration, wallet mapping and evidence. | Register from the intended owner wallet; tag supported transactions before first use. |
| Persistence & observability | Users, tasks, approvals, quotes, fills, paid calls, payments, tx hashes, errors, metrics and audit logs. | Every economic action must be reconstructable. |
| External infrastructure | Celo RPC, Textile APIs, buy catalogue/providers, Celo x402 facilitator, price feeds and optional Self verification. | Use environment-specific configuration and verify live endpoints. |

**5.1 Logical architecture**

Frontend → authenticated backend API → agent orchestrator.

Orchestrator → policy/risk engine → one of the three rail adapters.

Textile adapter → price feed \+ Textile RFQ/maker interface \+ dedicated maker wallet.

Buy adapter → buy catalogue \+ external x402 provider \+ project-tagged buyer wallet.

USA₮ adapter → x402 seller/buyer flow \+ Celo facilitator \+ independent counterparty wallet.

All adapters → common event ledger / database → dashboard, audit log and submission evidence.

ERC-8004 identity and transaction attribution are cross-cutting concerns, not separate product features.

**5.2 Important separation of wallets**

| Wallet | Purpose | Controls |
| :---- | :---- | :---- |
| Agent identity wallet | Owns the ERC-8004 agent registration and represents the agent identity. | Use the intended long-term owner key; avoid casual key rotation or transferring identity NFT. |
| Textile maker wallet | Holds working capital and signs maker orders. | Dedicated hot wallet or supported managed signer; strict inventory limits; never use personal treasury key. |
| Buy payer wallet | Pays for third-party x402 services and carries the hackathon attribution association. | Tagged wallet; per-call/per-day caps; separate spend ledger. |
| USA₮ payer/payee wallet(s) | Receives or pays real USA₮ from independent counterparties. | Keep the project's payment role explicit; never use team-controlled circular transfers as independent demand. |

These roles may be implemented with fewer wallets if the official hackathon instructions and security model allow it, but wallet reuse must be an explicit decision. Do not assume that one address can satisfy every sponsor's attribution, maker custody and ERC-8004 ownership requirements without checking.

**6\. Celo identity, payment and attribution requirements**

**6.1 ERC-8004**

ERC-8004 provides agent identity and trust registries. On Celo, the Identity Registry is documented at 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432 on mainnet. The registration transaction mints an identity NFT to the registering wallet and sets that wallet as the agent wallet. The agent registration file should describe the agent and list the real web/MCP/A2A endpoints.

Publish the registration JSON at a stable HTTPS or IPFS URL.

Register using the wallet intended to own/control the agent identity.

Read the agentId from the mined Registered event in the transaction receipt; do not rely on a preflight/simulation return value.

Update the registration file with the actual agentId and registry reference after registration.

Keep the agent endpoint live and ensure its metadata matches the running product.

**6.2 x402 and USA₮**

x402 uses HTTP 402 Payment Required to communicate the payment requirements. The buyer signs an authorisation; the facilitator verifies it and submits the settlement transaction. The facilitator does not custody the payment; funds move from payer to payee. The current Celo facilitator documentation lists USA₮ as a mainnet-supported EIP-3009 asset with six decimals.

The current facilitator charges its own service fee from the facilitator account balance (documentation currently describes gas at cost plus 0.3% of the payment value for priced assets). This is separate from the payment amount transferred from payer to seller. Budget for facilitator funding and confirm the current pricing/config before launch.

**6.3 Attribution — critical verification item**

| Potential blocker requiring organizer confirmation Celo's current x402 documentation states that facilitator-side attribution tagging for x402 settlements is not live yet. The hackathon page supplied by the owner says transactions must carry the entry tag and describes a tagged wallet / PayTo wallet for track attribution. We must obtain explicit guidance from Loops/Celo on how USA₮ x402 settlements and buy-paid x402 calls are credited while facilitator-side tagging is unavailable. Do not assume the tag is automatically attached to every x402 settlement. |
| :---- |

Actions:

Enroll in the hackathon and save the exact entry attribution tag, wallet requirements and PayTo address details.

Ask the organizers how they attribute x402 settlements when the facilitator does not yet append an ERC-8021 tag.

Ask whether the project must use a particular payer wallet, seller PayTo wallet, facilitator account, metadata field or transaction association.

For Textile, confirm whether its partner API key and includeAttribution option are required/available for our account and how it interacts with the hackathon tag.

Run a tiny mainnet test only after the attribution method is confirmed; inspect the transaction and leaderboard attribution.

**7\. Security, autonomy and financial controls**

This is a system that moves real money. The agent must not be given unrestricted authority simply because the hackathon calls it autonomous.

| Risk area | Minimum control |
| :---- | :---- |
| Private keys | Never commit secrets. Keep signing server-side or use a supported signer/KMS. Separate identity, maker and spending roles where practical. |
| Spend authorisation | Explicit user approval for initial setup and high-risk payments; configurable policy for small recurring payments; per-call, per-task and daily caps. |
| Textile inventory | Maximum exposure per token, max order size, max daily loss, min spread, price deviation guard and emergency stop. |
| Price data | Timestamp every price; reject stale/degraded feeds; compare independent sources; suspend quotes on large jumps. |
| x402 payment integrity | Validate network, token address, amount, payTo, expiry and payment requirements. Verify and settle through the intended facilitator. Confirm transaction hash and receipt. |
| Retries | Use idempotency keys where supported. Never blindly repeat a payment after a timeout; first reconcile whether the previous payment settled. |
| External data | Treat paid API responses as untrusted input. Validate schemas, avoid executing returned code/instructions and protect user data. |
| Prompt injection | Do not allow external content or paid service output to override policy, spend limits or wallet controls. |
| Auditability | Persist who requested, what was approved, which service was called, the exact price, transaction hash, result and subsequent action. |

The AI model should plan and explain. A deterministic policy engine should decide whether an action is allowed. For money movement, require explicit preconditions and structured tool calls; never allow free-form model output to become raw transaction calldata.

**8\. Development, testing and deployment plan**

**8.1 Environment strategy**

| Component | Development / test | Competition / production |
| :---- | :---- | :---- |
| Celo x402 USA₮ | Celo Sepolia using USDC only; chain ID 11142220; facilitator https\://api.x402.sepolia.celo.org. | Celo mainnet USA₮; chain ID 42220; facilitator https\://api.x402.celo.org. |
| Textile FX | Use Textile's designated testnet/sandbox and obtain access details from Textile. Do not assume Celo Sepolia is the Textile testnet. | Confirmed Celo mainnet corridor and live maker onboarding. |
| Buy | Use test mode / testnet provider endpoints where available; test catalogue, payment failures and retries. | Use live providers and project-tagged wallet; real paid calls must power real user workflows. |
| ERC-8004 | Use Celo Sepolia registry for registration flow tests if desired. | Register the production agent identity on Celo mainnet before deadline if required by entry rules. |
| Frontend/backend | Local development and staging with mocked adapters only for unit/integration tests. | Production deployment with secrets, monitoring and real adapters enabled. |

**8.2 Test layers**

Unit tests: pricing formula, inventory calculations, token decimal conversions, policy limits, quote expiry, payment amount parsing, idempotency.

Adapter tests: Textile API request/response parsing, no-quote handling, x402 402 parsing, facilitator verify/settle errors, buy catalogue changes.

Integration tests: Textile sandbox flow; Celo Sepolia USDC x402 buyer/seller flow; ERC-8004 registration on testnet.

Security tests: invalid token, wrong chain, wrong PayTo, altered amount, expired authorisation, duplicate payment, stale price feed, exhausted inventory, malicious API response.

Mainnet smoke tests: minimal, approved transactions after wallet/tag/config verification; capture hashes and verify on the explorer.

User acceptance tests: an independent pilot user completes the actual task without needing to understand the underlying rails.

**8.3 Deployment checklist**

Production environment variables are configured and not exposed to the client.

Correct Celo mainnet chain ID and RPC are selected.

Token addresses and decimals are read from official live configuration and checked against chain state.

Textile corridor, maker wallet, allowances and risk limits are verified.

Buy payer wallet, provider catalogue and spend limits are verified.

USA₮ facilitator key, asset config, PayTo address and facilitator funding are verified.

ERC-8004 registration and attribution rules are satisfied.

Monitoring, logs, kill switch and incident contact are active.

A backup/recovery procedure exists for the maker bot and payment service.

**9\. Team responsibilities and collaboration protocol**

| Role | Accountability | Expected outputs |
| :---- | :---- | :---- |
| Joseph — Product Owner | Owns product decisions, user/counterparty relationships, business validation, wallet approvals, sponsor communication and final submission. | Named pilot user; independent counterparties; approvals; final demo; submission narrative and sign-off. |
| ChatGPT — Technical Lead | Maintains this specification, research, architecture, acceptance criteria, integration contracts, risk review, task breakdown and final QA. | Architecture decisions; implementation tickets/prompts; code review checklists; integration validation; release checklist. |
| Claude — Technical Development Lead | Leads implementation planning and complex technical work; reviews architecture and code; identifies integration edge cases. | Technical plans; code changes assigned to Claude; independent reviews; debugging reports; tests. |
| GitHub Copilot — Second Developer | Implements scoped tasks in the repository, writes tests and handles routine wiring/refactoring under explicit instructions. | Small reviewed commits; test coverage; implementation notes; no unapproved architectural changes. |

**9.1 Rules of collaboration**

One shared repository and one agreed branch/merge policy. No parallel uncoordinated edits to the same files.

Before editing: inspect repository structure, git status, existing patterns, package versions and relevant files.

Every coding task states scope, allowed files, prohibited files, acceptance criteria, commands to run and expected evidence.

Do not rename existing variables, replace frameworks, rewrite large modules or install packages without approval.

Each developer reports files changed, rationale, commands run, test results, known limitations and next steps.

ChatGPT maintains the integration contract and resolves conflicting recommendations before code is merged.

Secrets, private keys, seed phrases, facilitator API keys and private customer data must never be pasted into chat, issues or committed files.

**9.2 Suggested repo documentation**

README.md — product, setup, user flow and demo instructions.

PROJECT\_BRIEF.md — this specification (or a maintained concise version).

ARCHITECTURE.md — components, data flow, wallets and trust boundaries.

TRACK\_REQUIREMENTS.md — separate Textile, buy and USA₮ acceptance criteria.

SECURITY.md — key handling, spending policy and incident controls.

RUNBOOK.md — deployment, restart, kill switch, monitoring and recovery.

EVIDENCE.md — independent users, paid calls, fills, settlement hashes and leaderboard attribution.

**10\. Deadline-driven execution plan**

The deadline is close. The project must be aggressively scoped. The plan below prioritises proving one real economic flow in each track over building a large feature set.

| Date / phase | Priority work | Exit condition |
| :---- | :---- | :---- |
| 4 Nov — Day 0 | Confirm entry tags, track registration, wallets, counterparty/user, Textile onboarding and x402 attribution. Audit repos and choose architecture. | No unresolved blocker about which wallets/tags/rails are needed; project scope frozen. |
| 5 Nov — Day 1 | Build app shell, shared event ledger, wallet/config layer, buy integration spike and x402 Sepolia seller/buyer flow. Inspect Stitch and run Textile sandbox. | Buy paid-call proof in test environment; x402 Sepolia USDC flow works; Textile test/onboarding path known. |
| 6 Nov — Day 2 | Implement the minimum end-to-end business workflow. Build Textile strategy adapter and risk controls. Deploy staging. | A user can execute the product flow in staging; all three adapters have integration tests. |
| 7 Nov — Day 3 | Mainnet readiness: attribution, ERC-8004, production wallet funding, independent user onboarding, first controlled Textile and USA₮ transactions. | At least one verified mainnet proof for each track, if sponsor access and counterparties are available. |
| 8 Nov — Day 4 | Stabilise, secure repeat usage, improve Textile quote/fill performance, capture repeat USA₮ payments and buy usage. Prepare demo and evidence. | Repeat flow and independent activity; stable dashboard; submission evidence collected. |
| 9 Nov — Deadline | Final smoke test, verify attribution and submissions, submit before 09:00 GMT. | Submission confirmed; repo and demo links accessible. |

| Scope fallback If time or access makes all three production integrations impossible, preserve the product architecture but prioritise the strongest verified track outcomes. Do not fabricate volume, users, fills, paid calls or settlement. Tell the truth in the submission. |
| :---- |

**11\. Submission package and evidence**

**11.1 Shared submission assets**

Public GitHub repository with clean README, architecture, setup and track-specific implementation notes.

Deployed application URL and a short, reliable demo path.

Agent ERC-8004 identity link / agentId and wallet.

Project attribution tag, tagged wallet(s), PayTo address(es) and explanation of the tracking approach.

Short demo video showing the real user task and the relevant onchain activity.

Named user/business persona and named independent counterparties (with consent to disclose).

A clear explanation of what the user previously did, what it cost in time/money, and what the agent changes.

**11.2 Textile evidence**

Celo mainnet corridor and maker identity/wallet.

Strategy explanation and parameters (without disclosing secrets).

Quote counts, quote sizes, quoted volume, fills, fill rate and independent taker activity.

Realised P\&L, mark-to-market P\&L, spread and inventory exposure.

Transaction hashes and Textile RFQ IDs/statuses.

Risk controls, price-feed source and kill-switch demonstration.

**11.3 Build with buy evidence**

Live catalogue item/provider selected and why.

Exact paid operation, amount, payment asset and timestamp.

Tagged payer wallet and transaction/receipt identifiers.

Returned data/result and how it materially supported the user's task.

Number of distinct independent users, paid calls and providers; repeat usage where available.

Proof that the consumed service is not controlled by our team.

**11.4 USA₮ evidence**

USA₮ mainnet settlement transaction hashes and explorer links.

Facilitator response/receipt and server-side verification logs.

Named independent payer/payee and what they paid for.

Repeat payments from the same independent counterparty.

Explanation of why USA₮ is appropriate for this counterparty and task.

Clear explanation of attribution method confirmed by hackathon organisers.

**12\. Key risks, blockers and decisions**

| Priority | Issue | Why it matters / required action |
| :---- | :---- | :---- |
| Critical | x402 facilitator attribution | Celo docs currently say facilitator-side x402 attribution is not live. Get written organizer instructions for crediting USA₮ and buy transactions before spending mainnet funds. |
| Critical | Textile maker onboarding and Celo corridor | A taker integration is not the Textile filler bounty. Confirm maker onboarding, supported Celo pair, inventory, test access and how our maker is tracked. |
| Critical | Independent counterparties | Both buy and USA₮ scoring depend on genuine demand/independent parties. Identify at least one user and one payer/payee immediately. |
| High | Working capital and risk | Textile needs inventory and an exit/hedge for the counter-asset. Define a small, approved capital budget and hard loss limits. |
| High | USA₮ vs USD₮ confusion | Textile corridors in the brief are against USD₮, while the USA₮ track uses USA₮. Treat them as different assets; do not assume direct conversion. |
| High | Deadline and integration breadth | Three tracks are ambitious in five days. Keep a minimal integrated product and prove distinct flows; defer nonessential features. |
| Medium | Self verification | Self may strengthen human verification, but only integrate if required by the selected user flow and feasible before deadline. Do not make it a blocker unless the organizer requires it. |
| Medium | Buy service selection | Do not pay for data or compute merely to generate activity. Choose a service with a direct, demonstrable connection to the user task. |

**12.1 Decisions to make immediately**

Confirm final pilot user/business and the recurring task they will complete.

Choose whether CorridorPilot is initially a treasury/procurement assistant for one small business segment or a narrower service with a faster path to real repeat usage.

Choose the Textile corridor and maker wallet after Textile confirms live Celo availability and minimum capital requirements.

Choose the buy provider(s) and exact paid operations that the product needs.

Choose the USA₮ seller/payee and the independent payer/counterparty; define what they receive for each payment.

Confirm the official entry tag, tagged wallet and x402 attribution workaround with Loops/Celo.

Set the maximum mainnet capital and loss budget for the project.

**13\. Official technical references**

Use these official references as the starting point. Always verify live values and API versions at implementation time.

[Textile FX — API v2 RFQ overview](https://fx-docs.textilecredit.com/api/v2/)

[Textile FX — RFQ endpoints](https://fx-docs.textilecredit.com/api/v2/rfq.html)

[Textile FX — become a filler](https://fx-docs.textilecredit.com/guides/how-to-become-a-filler.html)

[Textile FX — quoting settings](https://fx-docs.textilecredit.com/guides/quoting-the-order-book.html)

[Textile FX — fees](https://fx-docs.textilecredit.com/fees)

[Textile Stitch — source repository](https://github.com/textile-protocol/textile-stitch)

[Textile FX — testnet](https://fx-docs.textilecredit.com/testnet.html)

[Celo — x402 agent payments](https://docs.celo.org/build/agents/x402)

[Celo — x402 facilitator dashboard / config](https://x402.celo.org/)

[Celo — x402 integration skill](https://x402.celo.org/skill.md)

[Celo — ERC-8004 agent trust](https://docs.celo.org/build/agents/8004)

[Celo — attribution tags](https://docs.celo.org/build/agents/attribution-tags)

[buy — official skill repository](https://github.com/celo-org/buy-skill)

[buy — product and gateway](https://usebuy.ai/)

[Celo — Self integration](https://docs.celo.org/build/agents/self)

[Self — developer documentation](https://docs.self.xyz/)

[USA₮ — official site](https://usat.io/)

[x402 protocol — specification and SDKs](https://github.com/x402-foundation/x402)

[Celo Sepolia — network documentation](https://docs.celo.org/network/sepolia)

**14\. Initial team handoff prompt**

Paste the following into the shared Claude/Copilot working context after attaching this document and the repository:

| Shared project instruction We are building CorridorPilot (working name) for the Agents on Open Rails Hackathon. Read the complete Master Project Brief before proposing changes. The project targets three distinct tracks: Textile FX filler/quoting strategy on Celo mainnet; Build with buy using paid third-party x402 services; and USA₮ with x402 using independent counterparties and repeat mainnet settlement. Do not assume the three rails share a token or can be atomically chained. Treat USD₮ and USA₮ as distinct assets. First audit the repository, git status, package versions, current architecture and existing code. Do not edit files, install packages, rename variables or rewrite modules until the audit is reported and the task is approved. Identify critical blockers, especially Textile Celo maker onboarding and x402 attribution, which current Celo docs say is not yet live at the facilitator layer. For every implementation task, state exact files allowed, interfaces, acceptance criteria, test commands and rollback plan. Never use mock/self-transactions as competition evidence. Keep secrets out of source control. ChatGPT is technical lead and owns cross-track architecture and acceptance criteria; Claude leads technical development/review; Copilot implements scoped tasks; Joseph approves product, capital, wallet and submission decisions. |
| :---- |

**15\. Definition of done**

The project is ready for submission only when the team can answer “yes” to the relevant items below and can show evidence.

We can explain one real user problem in plain language and name the intended user.

The app works as one coherent product, not three disconnected sponsor demos.

Textile is a real Celo mainnet filler with a documented adaptive quoting strategy and independently verifiable fills/metrics.

Buy pays for a third-party service the team does not own, and the result powers the real user workflow.

USA₮ settles through the Celo mainnet x402 facilitator with an independent counterparty and repeat flow.

ERC-8004 identity is registered correctly from the intended wallet.

The attribution approach is confirmed and the activity is visible/creditable to the hackathon entry.

Wallets, secrets, spending caps, risk controls, logs and kill switches are in place.

The demo, repository, transaction evidence and track-specific explanations are ready before 9 November 2026, 09:00 GMT.

| Final operating principle Build for verifiable economic usefulness. One independent user who returns, one genuinely useful paid service, one properly risk-managed filler strategy, and repeat USA₮ settlement are more valuable than a large feature list with no real activity. |
| :---- |

Working document • 4 November 2026 • Verify live parameters before mainnet execution  
