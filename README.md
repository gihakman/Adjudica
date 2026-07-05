# Adjudica

**The verdict layer for multi-agent work.** Adjudica is a trustless service-level
agreement (SLA) and responsibility adjudication protocol for multi-agent workflows,
built as a GenLayer Intelligent Contract. Autonomous agents (or their operators)
commit to an SLA in plain language, submit evidence on-chain, and ask the network for
a ruling. GenLayer validators read the same evidence, reach consensus on whether the
work was delivered and who is at fault, and that verdict releases escrow and updates
reputation.

Live on GenLayer Testnet Bradbury:

- Contract: [`0x5CA915C40723d49cCdd4288F8B249E88fE90cF49`](https://explorer-bradbury.genlayer.com/address/0x5CA915C40723d49cCdd4288F8B249E88fE90cF49)
- Deploy transaction: [`0x6e883de77f65699583f7920eed3131659f93dcb8e7e3b41b0b4c10ee011d439f`](https://explorer-bradbury.genlayer.com/tx/0x6e883de77f65699583f7920eed3131659f93dcb8e7e3b41b0b4c10ee011d439f)

## The problem

The agentic-commerce stack is being built in the open: x402 for payments, ERC-8004
for agent identity, A2A for agent-to-agent task exchange, plus ACP, AP2, and others.
Every layer engineers the happy path. None ships dispute resolution. When one agent
claims another failed to deliver, there is no neutral, machine-speed way to weigh the
evidence, interpret the commitment, and attach a consequence.

That decision requires judgment, not just code. A deterministic smart contract cannot
evaluate "did the research agent deliver a synthesis that meets the brief?" A
centralized service can, but it reintroduces the trust point the stack was built to
remove.

## Why GenLayer

GenLayer validators run large language models and can reach consensus on the meaning of
unstructured evidence. Adjudica puts the consensus-critical decision, the verdict, into
an Intelligent Contract:

- Evidence is committed **on-chain**, so every validator adjudicates over identical,
  tamper-evident data. There is no external URL to trust or that can go down.
- The leader proposes a structured verdict. Each validator independently forms its own
  verdict and the network compares the **decision fields** (`fulfilled` and
  `fault_party`), tolerating differences in prose. This is a custom equivalence
  principle (`gl.vm.run_nondet_unsafe`).
- Accepted verdicts are appealable through GenLayer's Optimistic Democracy.

## How it works

A case moves from claim to verdict to settlement:

1. **Register the SLA.** `create_case` names the provider, the client, and the
   fulfillment criteria in natural language. Escrow is optional.
2. **Fund escrow (optional).** `fund_escrow` locks GEN. Settlement uses a safe
   withdraw (pull-payment) pattern.
3. **Commit evidence.** `submit_evidence` writes each party's log excerpts, outputs,
   and notes on-chain, each with an integrity hash.
4. **Adjudicate.** `adjudicate` runs the criteria and evidence through GenLayer
   validators and stores a verdict: `fulfilled`, `fault_party`
   (`provider` / `client` / `none`), the reasoning, and a confidence score.
5. **Settle.** `settle` releases escrow to the paid party, applies the protocol fee,
   and updates both parties' reputation. A fulfilled SLA pays the provider; a breach
   refunds the client unless the client itself was at fault, in which case the provider
   is compensated.
6. **Withdraw.** `withdraw` pulls a party's settled credit to their wallet.

Reputation is derived from outcomes: fulfilled count, breached count, fault count, and
a 0 to 100 score.

## Seeded cases (real, on-chain)

The docket is seeded with five fully adjudicated cases, each ruled by real validator
consensus with the reasoning stored on-chain:

| # | Case | Verdict | Settlement |
|---|------|---------|------------|
| 1 | Literature synthesis (5-paper review) | Fulfilled | Provider paid 0.0099 GEN, fee 0.0001 |
| 2 | ETL pipeline delivery | Breach, fault: provider | Client refunded 0.0198 GEN, withdrawn |
| 3 | Content moderation SLA | Fulfilled | No escrow |
| 4 | Ranking model refresh (blocked on client) | Fulfilled | Provider not at fault for a client-side blocker |
| 5 | Report handoff | Breach, fault: client | Provider compensated, no escrow |

Cases 2 and 5 show fault attributed to the provider and to the client respectively.
Every case is readable in the app's live docket, straight from the contract.

## Tech

- **Contract:** Python Intelligent Contract (`gl.Contract`) on GenLayer, pinned to a
  specific GenVM runner. Storage uses `TreeMap`, `DynArray`, and `u256` (atto-scale for
  GEN). See `contracts/adjudica.py`.
- **Tests:** `genlayer-test` direct mode (in-memory), plus `genvm-lint` static checks.
- **Deploy and seed:** `genlayer-js` scripts that sign with a funded key read from the
  environment.
- **Frontend:** React + Vite + `genlayer-js`. A documentation-first site with a live
  docket and an interactive read/write console. Reads go straight to the RPC with no
  wallet; writes are signed by a standard EIP-1193 wallet. The app adds and switches to
  Bradbury with `wallet_addEthereumChain` / `wallet_switchEthereumChain` directly, so
  no MetaMask Snap is required.

## Repository layout

```
contracts/adjudica.py        The Intelligent Contract
tests/direct/                Direct-mode tests (pytest + genlayer-test)
scripts/                     Deploy, seed, and verify (genlayer-js)
  deploy.mjs  seed.mjs  verify.mjs  common.mjs  deployment.json
frontend/                    React + Vite app (genlayer-js)
  src/                       App, components, lib, hooks, baked deployment.json
vercel.json                  Deploy the frontend from the repo root
.env.example                 Environment template (no secrets)
```

## Running it

Prerequisites: Node.js 18+, Python 3.12+ (the GenLayer SDK requires it), and a Bradbury
account with test GEN from the [faucet](https://testnet-faucet.genlayer.foundation).

### Contract: lint and test

```bash
python3.12 -m venv .venv && . .venv/bin/activate
pip install genvm-linter genlayer-test
genvm-lint check contracts/adjudica.py
pytest tests/direct/ -v
```

### Deploy and seed

Copy `.env.example` to `.env` and set `ACCOUNT_PRIVATE_KEY` (a funded Bradbury key).
The key is read from `process.env` only and is never logged or committed.

```bash
cd scripts
npm install
npm run deploy     # deploys to Bradbury, verifies live via a view read, records the address
npm run seed all   # runs the full lifecycle for the example cases (idempotent, resumable)
npm run verify     # reads every case, its evidence, and reputations back from the contract
```

Optional environment variables: `FEE_RECIPIENT` (blank uses the deployer) and `FEE_BPS`
(defaults to 100, meaning 1.00%).

### Frontend

```bash
cd frontend
npm install
npm run dev        # start the Vite dev server
npm run build      # production build into frontend/dist
```

The deployed contract address is baked into `frontend/src/deployment.json`, so the
hosted app works with no environment configuration.

### Deploy the frontend to Vercel

`vercel.json` at the repository root builds and serves the frontend. Import the repo in
Vercel and deploy; it installs and builds from `frontend/` and serves `frontend/dist`.

## Security and scope

- Adjudica is an evidence-based settlement mechanism, not a court, and nothing here is
  legal advice.
- The contract is on a public testnet. Value is test GEN.
- Escrow settlement uses a pull-payment (withdraw) pattern. Value transfers to an
  externally owned account execute on transaction finalization.
- The signing key is provided through the environment and is never committed. `.env` and
  agent tooling are gitignored.

## GenLayer

- [Documentation](https://docs.genlayer.com)
- [SDK reference](https://sdk.genlayer.com)
- [Bradbury explorer](https://explorer-bradbury.genlayer.com)
- [Builder portal](https://portal.genlayer.foundation)
