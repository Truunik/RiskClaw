import type { Hex, PoolMetrics, RiskMemo, VerifiedMemo } from "../types/risk.ts";

/// Wrapper around 0G Compute inference. Returns the raw memo plus the TEE
/// verification artifacts (response id, signature) the Guardian commits onchain.
///
/// Real implementation will use the 0G Compute SDK's processResponse() to
/// verify the ZG-Res-Key signature against the provider's TEE-attested key.
export interface ZeroGCompute {
  analyze(metrics: PoolMetrics): Promise<VerifiedMemo>;
}

export interface ZeroGComputeConfig {
  providerAddress: Hex;
  model: string;
  verify: boolean;
}

/// Heuristic stand-in. Replace .analyze() with a 0G Compute call once the
/// provider/model are configured; keep the same return shape so the rest of
/// the pipeline doesn't change.
export class HeuristicZeroGCompute implements ZeroGCompute {
  constructor(private config: ZeroGComputeConfig) {}

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
    const recommendedMaxSwapBps = score >= 7000 ? 200 : score >= 4000 ? 500 : 2_000;

    if (reasoning.length === 0) reasoning.push("pool nominal");
    reasoning.push(`recommended fee: ${(recommendedFee / 10_000).toFixed(2)}%`);

    const memo: RiskMemo = {
      riskScoreBps: score,
      recommendedFee,
      recommendedMaxSwapBps,
      reasoning,
      observations: metrics,
    };

    return {
      memo,
      provider: this.config.providerAddress,
      responseId: `zg-res-${Date.now()}`,
      teeSignature: ("0x" + "00".repeat(65)) as Hex,
      verifiedAt: Math.floor(Date.now() / 1000),
    };
  }
}
