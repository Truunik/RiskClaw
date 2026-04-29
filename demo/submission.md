# RiskClaw — ETHGlobal Agentic submission

## Tagline

A 0G-native autonomous risk guardian for Uniswap v4-style liquidity pools. AI proposes, deterministic guardrails dispose, the hook executes — every policy change is auditable.

## What it is

RiskClaw connects three things that usually live apart:

1. **A v4-style hook** that controls pool behavior on swaps and liquidity adds.
2. **A 0G autonomous-agent swarm** that reasons about risk in real time.
3. **An onchain `PolicyProof`** that binds every policy change to a TEE-attested LLM memo and metrics snapshot pinned to 0G Storage.

When a pool's risk profile shifts, the swarm decides whether the next swap should be `ALLOW`, `PENALTY_FEE`, or `BLOCK`. The hook never sees the LLM output directly — only a bounded policy struct in a registry that's gated by approved agents and proof-validity checks. Anyone can fetch the LLM's reasoning, the TEE attestation bundle, and the original metrics from 0G Storage by the roots committed onchain.

## Live on 0G Galileo testnet (chain 16602)

| Contract | Address |
| --- | --- |
| `PoolManager` | `0x8CE288F20FcC3bA20FF00b1efD969f006953F4Fa` |
| `RiskPolicyRegistry` | `0x804b7Df3814c6ba5A47E93043EA8da66a21B9351` |
| `RiskHook` (CREATE2-mined, flag bits `0x880`) | `0x24f58d75c64745a6a03e38f0cd38d133cf030880` |
| Demo pool | `0x2672da44…2a7c511f6` (DYNAMIC_FEE_FLAG) |
| `MockPoolScenario` | `0xD1158fa72718cB61260233Ab2229BF86521c371D` |
| Test routers | `SwapRouter 0xD20e3822…2Ea3` · `LPRouter 0x5b5f19E6…5C1D` |

Last verified end-to-end run:

- `updatePolicy` tx — `0x509444b8900b30801ec3faa1b836c4569a3c1feda6cf73aacb3e05d087ee065d`
- `swap` tx (effective fee 10.02%) — `0x1b94d6c989f1b03aa9701d9b6afbf4ce42c7666785ad01b5efcaf1eac25ebbc8`

## How it works

Three off-chain TypeScript agents, two 0G services, two onchain contracts.

### Off-chain agents

- **Observer** — reads pool metrics (TVL, 24h delta, last swap as bps of liquidity, price impact) and writes them to 0G Storage. Returns a `metricsRoot`.
- **Analyst** — calls a TEE-acknowledged provider on 0G Compute via `@0glabs/0g-serving-broker`, parses the structured JSON memo, verifies the response signature with `processResponse()`, and uploads the memo to 0G Storage. Returns `explanationRoot` + the full `VerifiedMemo` (provider, responseId, rawResponseHash, verificationResult, verifiedAt).
- **Guardian** — validates the memo against deterministic guardrails (max fee, max score, max single-update jump), uploads the proof artifact bundle to 0G Storage, and submits a signed `updatePolicy` tx to the registry. Returns `computeProofRoot`.

### 0G services

- **0G Storage** (`@0gfoundation/0g-ts-sdk`) — content-addressed storage for memos, proof artifacts, metrics snapshots, and append-only decision logs. Each upload returns a 32-byte root; downstream consumers fetch by root.
- **0G Compute** (`@0glabs/0g-serving-broker`) — TEE-verifiable inference. Provider/model are configurable; the demo uses `qwen/qwen-2.5-7b-instruct` on provider `0xa48f0128…67836`. The broker signs billing headers committing to user content; `processResponse()` verifies the response against the provider's TEE-attested key.

### Onchain

- **`RiskPolicyRegistry`** — stores `PoolRiskPolicy` per pool (score, fee, max swap, lastUpdated, updater, proof). `updatePolicy` is gated by `approvedAgents` mapping. `_validateProof` rejects any field that's zero, in the future, or older than 15 minutes. Hard caps: `MAX_FEE = 100,000 pips`, `MAX_SCORE = 10,000`, `STALE_AFTER = 1 hour`.
- **`RiskHook`** — v4 `BaseHook` deployed at a CREATE2-mined address whose low 14 bits are exactly `0x880` = `BEFORE_SWAP_FLAG | BEFORE_ADD_LIQUIDITY_FLAG`. On `beforeSwap`: reverts if stale, reverts if score ≥ `BLOCK_THRESHOLD (8500)`, enforces `maxAbsAmountSpecified`, otherwise returns `OVERRIDE_FEE_FLAG | dynamicFee` so the per-swap fee is the AI-set policy fee.

## What 0G features RiskClaw uses

### 0G Chain

- Custom `viem` chain definition (id 16602, gas price floor 3 gwei) — see `agents/src/executor.ts`.
- `RiskPolicyRegistry` and `RiskHook` deployed on Galileo; v4-compatible `PoolManager` deployed alongside because v4 has no official 0G deployment.
- Guardian submits signed `updatePolicy` transactions; verified end-to-end with real receipts and explorer links.

### 0G Storage

- KV memory for latest pool state (`kvSet` returns root).
- Append-only logs per pool for observations and decisions.
- Memo + proof artifact uploads return content-addressed roots that end up in `PolicyProof`.
- `bun run demo:explain <root>` fetches by root and pretty-prints the memo or the proof bundle — the demo's "click to verify" surface.
- Smoke test: `bun run storage:smoke` (round-trip upload → download → byte-compare).

### 0G Compute

- TEE-verifiable inference for the Analyst agent — see `agents/src/compute/zeroGCompute.ts:RealZeroGCompute`.
- Provider, model, responseId, prompt hash, model hash, and verification result all committed onchain.
- Smoke test: `bun run compute:fund-and-test` (creates ledger, picks acknowledged provider, runs a chat completion, verifies TEE — passes with `TEE valid: true`).

### Uniswap v4 (deployed on 0G)

- `BaseHook` with `beforeSwap` returning `(selector, ZERO_DELTA, OVERRIDE_FEE_FLAG | fee)`.
- `beforeAddLiquidity` blocks LP deposits into red pools.
- Pool initialized with `LPFeeLibrary.DYNAMIC_FEE_FLAG` so per-swap overrides apply.
- Hook deployed via `HookMiner` CREATE2 so flag bits in the address match declared permissions.

## Prize tracks

### Primary: Best Autonomous Agents, Swarms and iNFT Innovations

RiskClaw is an actual agent system, not an SDK wrapper. Each agent owns a separate concern, persists its state to 0G Storage, and refuses to act on inputs that don't survive deterministic checks:

- **Observer owns facts** — its metrics root is the input to everything else.
- **Analyst owns interpretation** — it can hallucinate, but only inside the bounded JSON schema, and only over a TEE-signed response.
- **Guardian owns permissioned action** — it refuses to act if the analyst's recommendation crosses guardrails, and the registry refuses if the guardian's proof is malformed or stale.

This is structurally stronger than a "five-agent swarm" where every "agent" is a method in the same process: each RiskClaw agent writes independently auditable state to 0G Storage, and the trust boundary between agents is enforced both off-chain (the JSON schema) and onchain (the registry's proof validation).

### Secondary: Best Agent Framework, Tooling and Core Extensions

The reusable pieces are designed to lift cleanly into a hook-agent kit:

- `memory/` — 0G Storage adapter (KV + log + memo upload) behind a single interface.
- `compute/` — 0G Compute adapter with strict-JSON memo prompt + defensive parser + TEE verification.
- `policy/` — schema and guardrails (max fee, max score, max jump per update).
- `hooks/` — v4 hook adapters (registry-reading hook patterns).

The Uniswap risk hook becomes the flagship example for any builder who wants a v4 hook driven by a 0G agent loop. The framework story is credible because there's a working example end-to-end on 0G testnet, not slideware.

## Try it

```bash
git clone https://github.com/Truunik/RiskClaw
cd RiskClaw
cp .env.example .env  # fill in keys
cd agents && bun install
bun run loop                    # full agent loop on 0G testnet
bun run demo:state              # current pool mode
bun run demo:explain <root>     # fetch memo or proof from 0G Storage
bun run demo:swap               # actual swap through the live hook
```

Open `demo/index.html` in a browser for an interactive knowledge-graph view of the audit chain with all live testnet addresses and last-run transaction hashes.

## Test status

- 28/28 Foundry tests passing (11 hook + 17 registry).
- TypeScript typecheck clean across agents.
- 0G Compute smoke (`compute:fund-and-test`) passes with `TEE valid: true`.
- 0G Storage smoke (`storage:smoke`) round-trip clean.

## Repo

[`github.com/Truunik/RiskClaw`](https://github.com/Truunik/RiskClaw) — public, MIT-licensed, single-branch (`main`).
