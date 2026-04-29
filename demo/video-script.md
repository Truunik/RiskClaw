# RiskClaw — 3-minute demo video script

Target length: **2:55–3:00**. Pace assumes a confident voiceover (~140 wpm) over screen recording. Shoot in three takes (problem → loop → swap) so each segment can be retried without redoing the whole thing.

---

## 0:00–0:20 — Cold open: the problem

> **On screen:** title card "RiskClaw" → cuts to a stylized v4 pool diagram.

> **VO:** Uniswap v4 hooks let pools be programmable. But the moment you wire an LLM to a hook, you have a problem: large-language-model output is unpredictable, unsigned, and unauditable. Either the AI never touches the pool — or it owns the pool, and you're trusting the prompt.

> **VO:** RiskClaw is a third option. A 0G-native autonomous risk guardian where the AI reasons off-chain, the TEE attests to the response, and a deterministic v4 hook enforces only what survives. Every policy change is fetchable proof.

---

## 0:20–0:50 — Architecture in 30 seconds

> **On screen:** open `demo/index.html`, slowly pan across the knowledge graph. Click each node briefly — Pool, Observer, Analyst, Guardian, 0G Storage, 0G Compute, Registry, RiskHook, Swapper.

> **VO:** Three off-chain agents — Observer reads the pool, Analyst calls 0G Compute under TEE, Guardian validates against guardrails and signs the transaction. Two 0G services persist the audit trail: Storage holds the metrics, the LLM memo, and the TEE attestation; Compute runs the actual model. Two onchain contracts close the loop: a Registry holds the bounded policy plus its proof, and a v4 hook reads the registry on every swap.

> **VO:** The hook never sees the model output directly. It only sees a `PolicyProof` struct — and the chain of roots inside it points to bytes anyone can fetch from 0G Storage to audit *why* the fee changed.

---

## 0:50–1:50 — Live: the loop

> **On screen:** terminal. Run `bun run loop`. Show the output streaming: Observer metrics root, Analyst calling Compute, **`TEE verified true`**, Guardian, Executor tx hash. Highlight the responseId.

> **VO:** This is `bun run loop` against 0G Galileo testnet. Real Storage. Real Compute. Real onchain.

> **VO:** Observer pins a metrics snapshot. Analyst sends them to a TEE-acknowledged provider serving Qwen-2.5-7B — there's the response id, e7dc27f2. The broker calls `processResponse` and gets a verified-true back from the TEE. The model said: score 6,200, recommend a 10% fee, max swap fifty tokens. Three reasoning bullets.

> **VO:** Guardian checks deterministic guardrails — the model can't bump the fee more than 50,000 pips per update, can't push score past max, can't post stale proofs. It uploads the proof artifact to Storage, then signs an `updatePolicy` transaction.

> **On screen:** highlight the tx hash, paste it into chainscan-galileo.0g.ai. Show the receipt.

> **VO:** Tx confirmed in ten seconds. The pool's policy is now `PENALTY_FEE` mode, with proof roots pointing back to the memo, the TEE attestation, and the original metrics — all on 0G Storage.

---

## 1:50–2:30 — Money shot: the swap

> **On screen:** terminal. Run `bun run demo:state` to show the pool in `PENALTY_FEE` mode with the 10% fee. Then run `bun run demo:swap`. Show the output.

> **VO:** Now the part that matters: an actual swap. `demo:state` reads the live registry — pool is in PENALTY_FEE, fee 10.00%, all proof roots present.

> **VO:** And `demo:swap` puts a hundred milliunits of token zero into the pool through PoolSwapTest. The hook fires `beforeSwap`. It reads the registry. It returns `OVERRIDE_FEE_FLAG | 100,000`.

> **On screen:** highlight the line `effective ~10.02%`.

> **VO:** Effective fee on the actual settled swap: ten point oh two percent. That's the AI's recommendation, applied to a real swap, on a real chain. The point-zero-two is price impact on the wide-range pool. The ten percent is the hook honoring an AI policy that's bound to a TEE attestation that's pinned to 0G Storage at fetchable roots.

---

## 2:30–3:00 — Close: why this matters

> **On screen:** the knowledge graph again, with the policy update tx and swap tx pinned. Cut to the github URL.

> **VO:** What 0G uniquely makes possible: an AI agent that can reason about pool risk in real time, with verifiable inference, persistent state, and onchain enforcement — all on one network. RiskClaw turns that into a working pattern: the LLM proposes, deterministic guardrails dispose, the hook executes.

> **VO:** Open source. github.com/Truunik/RiskClaw. The reusable pieces — 0G Storage adapter, 0G Compute adapter, policy guardrails, v4 hook — drop into any builder's hook agent project.

> **End card:** RiskClaw · github.com/Truunik/RiskClaw · ETHGlobal Agentic 2026

---

## Production notes

- **Two terminal recordings**: the `bun run loop` recording and the `bun run demo:swap` recording. Pre-run them once so the policy is fresh before the take, then reset terminal scrollback before the take you keep.
- **Avoid showing `.env`** in any frame. Run `clear` after each command if the terminal echoes anything sensitive.
- **Time the highlights**: when the tx hash appears, freeze for 1.5s before the cursor moves on. When `effective ~10.02%` appears, hold for 2s.
- **Audio**: keep the VO under the visible terminal action — don't talk over the bursty LLM output, talk during the wait-for-receipt pauses.
- **Optional B-roll**: 5–10s of the knowledge graph in `demo/index.html` while VO covers the architecture. Useful filler if the live take runs short.
