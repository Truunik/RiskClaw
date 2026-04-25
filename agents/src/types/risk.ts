export type Hex = `0x${string}`;

export interface PoolMetrics {
  poolId: Hex;
  tvl: bigint;
  tvlDelta24hBps: number;
  isDrain: boolean;
  lastSwapAmountBps: number;
  priceImpactBps: number;
  observedAt: number;
}

export interface RiskMemo {
  riskScoreBps: number;
  recommendedFee: number;
  recommendedMaxAbsAmount: bigint;
  reasoning: string[];
  observations: PoolMetrics;
}

export interface VerifiedMemo {
  memo: RiskMemo;
  provider: Hex;
  model: string;
  responseId: string;
  rawResponseHash: Hex;
  teeSignature: Hex;
  verificationResult: boolean;
  verifiedAt: number;
}

export interface PolicyProof {
  explanationRoot: Hex;
  computeProofRoot: Hex;
  metricsRoot: Hex;
  promptHash: Hex;
  modelHash: Hex;
  provider: Hex;
  responseIdHash: Hex;
  verifiedAt: number;
}

export interface PolicyUpdate {
  poolId: Hex;
  riskScoreBps: number;
  dynamicFee: number;
  maxAbsAmountSpecified: bigint;
  proof: PolicyProof;
}
