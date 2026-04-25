import { keccak256, toBytes } from "viem";
import type { Hex, PolicyProof, PolicyUpdate, VerifiedMemo } from "./types/risk.ts";
import type { ZeroGMemory } from "./memory/zeroGMemory.ts";

export interface Guardrails {
  maxFee: number;
  maxScore: number;
  // Reject the analyst if its recommendation crosses these magnitudes from the
  // current onchain policy in a single update — defends against a hijacked or
  // hallucinating analyst flipping a healthy pool to BLOCK in one tx.
  maxFeeJump: number;
  maxScoreJump: number;
}

export const DEFAULT_GUARDRAILS: Guardrails = {
  maxFee: 100_000,
  maxScore: 10_000,
  maxFeeJump: 50_000,
  maxScoreJump: 4_000,
};

/// Guardian = critic + executor. Validates the verified memo against hard
/// guardrails and the previous policy, persists the decision log to 0G
/// Storage, and produces the PolicyUpdate the executor will submit onchain.
export class Guardian {
  constructor(private memory: ZeroGMemory, private guardrails: Guardrails = DEFAULT_GUARDRAILS) {}

  async decide(
    poolId: Hex,
    verified: VerifiedMemo,
    explanationRoot: Hex,
    previous?: { riskScoreBps: number; dynamicFee: number },
  ): Promise<PolicyUpdate | null> {
    const { memo } = verified;
    const reasons: string[] = [];

    if (memo.recommendedFee > this.guardrails.maxFee) reasons.push("fee > maxFee");
    if (memo.riskScoreBps > this.guardrails.maxScore) reasons.push("score > maxScore");
    if (previous) {
      if (Math.abs(memo.recommendedFee - previous.dynamicFee) > this.guardrails.maxFeeJump) {
        reasons.push("fee jump > guardrail");
      }
      if (Math.abs(memo.riskScoreBps - previous.riskScoreBps) > this.guardrails.maxScoreJump) {
        reasons.push("score jump > guardrail");
      }
    }

    const decision = {
      poolId,
      approved: reasons.length === 0,
      reasons,
      memo,
      teeProvider: verified.provider,
      responseId: verified.responseId,
      decidedAt: Math.floor(Date.now() / 1000),
    };
    const computeProofRoot = await this.memory.logAppend(`pool:${poolId}:decisions`, decision);

    if (!decision.approved) return null;

    const proof: PolicyProof = {
      explanationRoot,
      computeProofRoot,
      provider: verified.provider,
      responseIdHash: keccak256(toBytes(verified.responseId)),
      verifiedAt: verified.verifiedAt,
    };

    return {
      poolId,
      riskScoreBps: memo.riskScoreBps,
      dynamicFee: memo.recommendedFee,
      maxSwapBps: memo.recommendedMaxSwapBps,
      proof,
    };
  }
}
