import type { Hex, PoolMetrics } from "./types/risk.ts";
import type { ZeroGMemory } from "./memory/zeroGMemory.ts";

/// Observer = watcher + quant. Reads pool state (from MockPoolScenario in the
/// demo, real PoolManager events in v1), computes deterministic risk metrics,
/// writes them to 0G Storage KV. Emits a memory root the Analyst keys off.
export class Observer {
  constructor(private memory: ZeroGMemory) {}

  async observe(poolId: Hex, raw: RawPoolSnapshot): Promise<{ metrics: PoolMetrics; root: Hex }> {
    const metrics: PoolMetrics = {
      poolId,
      tvl: raw.tvl,
      tvlDelta24hBps: raw.tvlDelta24hBps,
      isDrain: raw.isDrain,
      lastSwapAmountBps: raw.lastSwapAmountBps,
      priceImpactBps: raw.priceImpactBps,
      observedAt: Math.floor(Date.now() / 1000),
    };

    const root = await this.memory.kvSet(`pool:${poolId}:latest`, metrics);
    await this.memory.logAppend(`pool:${poolId}:observations`, metrics);
    return { metrics, root };
  }
}

export interface RawPoolSnapshot {
  tvl: bigint;
  tvlDelta24hBps: number;
  isDrain: boolean;
  lastSwapAmountBps: number;
  priceImpactBps: number;
}
