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
  recommendedMaxSwapBps: number;
  reasoning: string[];
  observations: PoolMetrics;
}

export interface VerifiedMemo {
  memo: RiskMemo;
  provider: Hex;
  responseId: string;
  teeSignature: Hex;
  verifiedAt: number;
}

export interface PolicyProof {
  explanationRoot: Hex;
  computeProofRoot: Hex;
  provider: Hex;
  responseIdHash: Hex;
  verifiedAt: number;
}

export interface PolicyUpdate {
  poolId: Hex;
  riskScoreBps: number;
  dynamicFee: number;
  maxSwapBps: number;
  proof: PolicyProof;
}
