# RiskClaw

**An autonomous risk guardian for v4-style liquidity pools, powered by 0G.**

RiskClaw watches pool behavior, stores persistent risk memory on 0G Storage,
runs verifiable AI risk analysis on 0G Compute, and updates an onchain policy
registry that a Uniswap v4-style hook reads before every swap and liquidity
add. The reusable pieces form a lightweight framework for building more
0G-powered hook agents.

> Built for the ETHGlobal agentic hackathon.

## What it does

A 0G agent swarm decides, in real time, how a Uniswap v4 pool should behave
under risk: ALLOW, PENALTY_FEE, or BLOCK. Three agents coordinate through
0G Storage; the policy update is committed onchain alongside a TEE-verified
explanation root, so anyone can audit *why* the policy changed.

```
ALLOW         healthy pool         baseline fee
PENALTY_FEE   degraded but live    fee bumped by hook
BLOCK         catastrophic         swap/add reverts in beforeSwap
```

## Live demo

```bash
cd agents && bun install && cp ../.env.example ../.env  # fill in keys
bun run loop                                            # full agent loop
bun run demo:explain <root>                             # fetch memo/proof
                                                        # by 0G Storage root
```

A real run on 0G Galileo testnet (chain id 16602), with real 0G Compute and
real 0G Storage:

```
[memory]    backend: ZeroGStorageMemory
[compute]   backend: RealZeroGCompute model: qwen/qwen-2.5-7b-instruct
[executor]  backend: onchain
[Observer]  metrics root 0x08c73a14…85669056
[Analyst]   memo root    0xa4ec75b2…0707666a
[Analyst]   risk score   6200
[Analyst]   reasoning    ["High TVL drain","Significant lastSwapAmount","Moderate price impact"]
[Analyst]   provider     0xa48f01287233509FD694a22Bf840225062E67836
[Analyst]   responseId   e7dc27f2-23ce-4771-9613-f8e5e39c1757
[Analyst]   TEE verified true
[Guardian]  policy update
            score                   6200
            fee                     100000
            maxAbsAmountSpecified   50000000000000000000
            proof.explanationRoot   0xa4ec75b2…0707666a
            proof.computeProofRoot  0x5ebd1df5…e9fae3e1
            proof.metricsRoot       0x08c73a14…85669056
[Executor]  tx       0x509444b8900b30801ec3faa1b836c4569a3c1feda6cf73aacb3e05d087ee065d
[Executor]  explorer https://chainscan-galileo.0g.ai/tx/0x509444b8900b30801ec3faa1b836c4569a3c1feda6cf73aacb3e05d087ee065d
[Executor]  confirmed in 10524ms
```

That single transaction is the entire RiskClaw thesis: a real 7B-param LLM
running in a TEE under 0G Compute justified the policy change, the memo and
TEE attestation are pinned to 0G Storage at fetchable roots, and a v4 hook
sitting in front of the pool will read the new policy on the next swap.

## Deployed on 0G Galileo testnet

| Contract              | Address                                      |
| --------------------- | -------------------------------------------- |
| `PoolManager`         | `0x8CE288F20FcC3bA20FF00b1efD969f006953F4Fa` |
| `RiskPolicyRegistry`  | `0x804b7Df3814c6ba5A47E93043EA8da66a21B9351` |
| `RiskHook`            | `0x24f58d75c64745a6a03e38f0cd38d133cf030880` |
| `MockPoolScenario`    | `0xD1158fa72718cB61260233Ab2229BF86521c371D` |
| Demo pool ID          | `0x2672da44…2a7c511f6` (dynamic fee, RiskHook attached) |

The hook is at a CREATE2-mined address whose low 14 bits are exactly
`0x880` = `BEFORE_SWAP_FLAG | BEFORE_ADD_LIQUIDITY_FLAG` — the v4
PoolManager rejects hooks whose address bits don't match their declared
permissions.

## Architecture

```
Uniswap v4 Pool / PoolManager (deployed on 0G testnet)
        │
        ▼
RiskHook.sol
  beforeSwap        — block on red, override fee on yellow
  beforeAddLiquidity — block on red
        │ reads
        ▼
RiskPolicyRegistry.sol
  pool risk score / dynamic fee / max swap / stale guard
  PolicyProof: explanationRoot + computeProofRoot + provider + responseIdHash
        ▲ writes
        │
0G Agent Swarm
  Observer  — pool snapshots → 0G Storage KV
  Analyst   — 0G Compute TEE-verified risk memo
  Guardian  — guardrails + signed policy tx
        │
        ▼
0G Storage   ←  KV (live state)  +  Log (decisions)  +  Memo upload (root)
0G Compute   ←  inference + TEE response signature
```

## 0G features used

- **0G Chain** — RiskPolicyRegistry, PoolManager, RiskHook deployed on 0G
  testnet. Policy updates submitted by the Guardian's signed tx.
- **0G Storage** — KV for latest pool state; append-only logs for every
  observation and decision; memo upload returns the `explanationRoot` that
  is committed onchain in `PolicyProof`.
- **0G Compute** — LLM risk analysis via the configured chatbot provider
  (TEE-verifiable). Provider, model, and `responseId` go into `PolicyProof`
  so anyone can audit which provider justified a given policy change.
- **Uniswap v4 (core, on 0G)** — `BaseHook` with `beforeSwap` returning a
  per-swap fee override (`OVERRIDE_FEE_FLAG`); `beforeAddLiquidity` blocks
  LP deposits into red pools.

## How the full loop works

1. **Observer** reads a pool snapshot (from `MockPoolScenario` in the demo,
   from `PoolManager` events in v1) and writes deterministic metrics to
   0G Storage KV. Returns a memory root.
2. **Analyst** sends those metrics to 0G Compute, gets back a structured
   risk memo signed by the provider's TEE key, uploads the memo to 0G
   Storage and returns the `explanationRoot`.
3. **Guardian** validates the memo against hard guardrails (max fee, max
   score, max single-update jump), logs the decision to 0G Storage, and —
   if approved — assembles a `PolicyUpdate` and submits the tx to
   `RiskPolicyRegistry`.
4. **RiskHook** reads the registry on the next swap. Stale or red ⇒ revert.
   Yellow ⇒ fee override. Green ⇒ pass.

## Contracts (`/contracts`)

- `src/RiskHook.sol` — v4 hook (`beforeSwap`, `beforeAddLiquidity`).
- `src/RiskPolicyRegistry.sol` — onchain policy + `PolicyProof` struct.
- `src/MockPoolScenario.sol` — scripted "risk event" source for demo.
- `script/Deploy0G.s.sol` — 0G testnet deployment for PoolManager,
  Registry, and Scenario. Hook deployment lives in a follow-up script
  because v4 hooks require CREATE2 salt mining.

```bash
cd contracts
forge install
forge test
```

## Agents (`/agents`)

- `src/observer.ts` · `src/analyst.ts` · `src/guardian.ts`
- `src/memory/zeroGMemory.ts` — 0G Storage interface + in-memory dev impl.
- `src/compute/zeroGCompute.ts` — 0G Compute interface + heuristic dev impl.
- `src/run-loop.ts` — wires all three agents end-to-end.

```bash
cd agents
bun install
bun run loop
```

## Framework extraction (later)

When the demo loop is solid, the reusable pieces lift cleanly into
`/packages/hook-agent-kit`:

- `memory/` — 0G Storage adapters
- `compute/` — 0G Compute adapter + TEE verification helpers
- `policy/` — schema + guardrails
- `hooks/` — v4 hook adapters

Then the Uniswap risk hook becomes the flagship example for any builder
who wants a v4 hook driven by a 0G agent loop.

## Status

- [x] Foundry + v4-core + v4-hooks-public installed
- [x] `RiskPolicyRegistry` + `PolicyProof` with full guardrails (17/17 tests)
- [x] `RiskHook` with stale / block / fee-override / swap-cap (11/11 tests)
- [x] `MockPoolScenario` for reliable demo trigger
- [x] Three agents (Observer / Analyst / Guardian) running end-to-end locally
- [x] Real 0G Compute SDK call (TEE-verified `qwen/qwen-2.5-7b-instruct`)
- [x] Real 0G Storage SDK call (memo, proof artifact, metrics, decision logs)
- [x] `DeployHook.s.sol` with HookMiner CREATE2 — flag-bit address mined
- [x] Pool initialized with `DYNAMIC_FEE_FLAG` so per-swap overrides apply
- [x] Executor: signed `updatePolicy` tx to `RiskPolicyRegistry` (live on 0G)
- [x] `demo:explain <root>` CLI for fetching memo/proof from 0G Storage
- [ ] `demo:state` CLI for reading current pool mode/fee/roots from registry
- [ ] `demo:swap` script exercising the live hook end-to-end on testnet
- [ ] (P2) `RiskGuardian` ERC-7857 iNFT
