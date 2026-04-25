import { keccak256, toBytes } from "viem";
import type { Hex, PoolMetrics, RiskMemo, VerifiedMemo } from "../types/risk.ts";

/// Wrapper around 0G Compute inference. Returns the raw memo plus the TEE
/// verification artifacts (response id, signature, verification result) the
/// Guardian commits onchain.
///
/// Real implementation will use the 0G Compute SDK's processResponse() to
/// verify the ZG-Res-Key signature against the provider's TEE-attested key.
export interface ZeroGCompute {
  analyze(metrics: PoolMetrics): Promise<VerifiedMemo>;
  promptHash(): Hex;
  modelHash(): Hex;
}

export interface ZeroGComputeConfig {
  providerAddress: Hex;
  model: string;
  verify: boolean;
}

const PROMPT_TEMPLATE = `You are a DeFi risk analyst. Given pool metrics (TVL, 24h delta, last swap size as bps of liquidity, price impact bps), produce a structured risk memo with riskScoreBps (0-10000), recommendedFee (pips), recommendedMaxAbsAmount (uint128), and a list of reasoning lines. Be conservative.`;

/// Heuristic stand-in. Replace .analyze() with a 0G Compute call once the
/// provider/model are configured; keep the same return shape so the rest of
/// the pipeline doesn't change.
export class HeuristicZeroGCompute implements ZeroGCompute {
  constructor(private config: ZeroGComputeConfig) {}

  promptHash(): Hex {
    return keccak256(toBytes(PROMPT_TEMPLATE));
  }
  modelHash(): Hex {
    return keccak256(toBytes(this.config.model));
  }

  async analyze(metrics: PoolMetrics): Promise<VerifiedMemo> {
    const reasoning: string[] = [];
    let score = 0;

    if (metrics.isDrain && metrics.tvlDelta24hBps > 5000) {
      score += 4500;
      reasoning.push(`${(metrics.tvlDelta24hBps / 100).toFixed(1)}% liquidity drained in 24h`);
    }
    if (metrics.lastSwapAmountBps > 1500) {
      score += 2000;
      reasoning.push(`swap size ${(metrics.lastSwapAmountBps / 100).toFixed(1)}% of active liquidity`);
    }
    if (metrics.priceImpactBps > 500) {
      score += 1500;
      reasoning.push(`price impact ${(metrics.priceImpactBps / 100).toFixed(1)}% exceeds threshold`);
    }
    score = Math.min(score, 9999);

    const recommendedFee = score >= 7000 ? 30_000 : score >= 4000 ? 10_000 : 3_000;
    // Absolute swap cap. Tightens as risk rises. Scales relative to TVL so the
    // cap means something even on small pools; a real 0G Compute version can
    // reason about token decimals + active liquidity properly.
    const tvlFraction = score >= 7000 ? 50n : score >= 4000 ? 200n : 0n; // bps; 0 = no cap
    const recommendedMaxAbsAmount = tvlFraction === 0n ? 0n : (metrics.tvl * tvlFraction) / 10_000n;

    if (reasoning.length === 0) reasoning.push("pool nominal");
    reasoning.push(`recommended fee: ${(recommendedFee / 10_000).toFixed(2)}%`);

    const memo: RiskMemo = {
      riskScoreBps: score,
      recommendedFee,
      recommendedMaxAbsAmount,
      reasoning,
      observations: metrics,
    };

    const memoJson = JSON.stringify(memo, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    const rawResponseHash = keccak256(toBytes(memoJson));

    return {
      memo,
      provider: this.config.providerAddress,
      model: this.config.model,
      responseId: `zg-res-${Date.now()}`,
      rawResponseHash,
      teeSignature: ("0x" + "00".repeat(65)) as Hex,
      verificationResult: this.config.verify,
      verifiedAt: Math.floor(Date.now() / 1000),
    };
  }
}
