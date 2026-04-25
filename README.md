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
cd agents && bun install && bun run loop
```

You'll see the full pipeline fire on a scripted risk-spike scenario:

```
[Observer]  metrics root 0x12471f...
[Analyst]   memo root    0x59329e...
[Analyst]   risk score   8000
[Analyst]   reasoning    [ "74.0% liquidity drained in 24h",
                          "swap size 18.0% of active liquidity",
                          "price impact 6.2% exceeds threshold",
                          "recommended fee: 3.00%" ]
[Guardian]  policy update
            score    8000   fee 30000   maxSwap 200
            proof.explanationRoot  0x59329e...
            proof.computeProofRoot 0x392808...
```

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
- [x] `RiskPolicyRegistry` + `PolicyProof` with full guardrails (7/7 tests)
- [x] `RiskHook` skeleton compiles against v4-core / v4-hooks-public
- [x] `MockPoolScenario` for reliable demo trigger
- [x] Three agents (Observer / Analyst / Guardian) running end-to-end locally
- [ ] Real 0G Compute SDK call replacing heuristic stand-in
- [ ] Real 0G Storage SDK call replacing in-memory stand-in
- [ ] `DeployHook.s.sol` with HookMiner CREATE2 salt + 0G testnet deploy
- [ ] Executor: signed policy tx to `RiskPolicyRegistry`
- [ ] (P2) `RiskGuardian` ERC-7857 iNFT
