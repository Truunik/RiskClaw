# RiskClaw

**An autonomous risk guardian for Uniswap v4-style liquidity pools — powered by 0G.**

When a pool's risk profile shifts — liquidity drains, abnormal swaps,
oracle anomalies — LPs and traders have no consistent way to react in
real time. Risk dashboards exist; automated, auditable enforcement at
the pool level does not.

RiskClaw makes that enforcement automatic, deterministic, and
auditable. A 0G-powered agent swarm watches the pool, reasons about
risk, and submits *bounded* policy updates onchain. A Uniswap
v4-style hook reads those policies before every swap and liquidity
add, and routes the pool through one of three modes:

- **ALLOW** — healthy pool, baseline fee
- **PENALTY_FEE** — degraded but live, fee bumped at the hook
- **BLOCK** — catastrophic, swap reverts in `beforeSwap`

## Why 0G + Uniswap v4

- Uniswap v4 hooks make pool behavior programmable.
- 0G makes AI agents verifiable, persistent, and onchain-native.

RiskClaw is the bridge: a reusable control plane that lets autonomous
agents govern hook policy without making the hook itself
nondeterministic. The hook is dumb on purpose. The agents can reason
freely offchain — but only **bounded, TEE-verifiable, root-committed
policies** ever reach the hook.

## What it is, what it isn't

- It **is** an autonomous agent system that monitors v4-style pools,
  runs verifiable risk analysis on 0G Compute, persists reasoning to
  0G Storage, and updates an onchain policy registry that the hook
  reads.
- It **is not** an LLM that controls swap math. AI never touches the
  pool's pricing curve. It can only update bounded policy, and every
  update commits proof roots on 0G that anyone can audit after the
  fact.

## Status

Built for the ETHGlobal agentic hackathon. Active development —
full code drops on hackathon submission.

## License

MIT.
