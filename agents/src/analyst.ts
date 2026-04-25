import type { PoolMetrics, VerifiedMemo } from "./types/risk.ts";
import type { ZeroGCompute } from "./compute/zeroGCompute.ts";
import type { ZeroGMemory } from "./memory/zeroGMemory.ts";

/// Analyst = 0G Compute inference + memo persistence. Sends metrics to the
/// configured chatbot provider, gets back a TEE-verified memo, uploads the
/// memo bytes to 0G Storage, returns the storage root for onchain commitment.
export class Analyst {
  constructor(private compute: ZeroGCompute, private memory: ZeroGMemory) {}

  async analyze(metrics: PoolMetrics): Promise<{ verified: VerifiedMemo; explanationRoot: `0x${string}` }> {
    const verified = await this.compute.analyze(metrics);
    const json = JSON.stringify(verified.memo, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    const explanationRoot = await this.memory.upload(new TextEncoder().encode(json));
    return { verified, explanationRoot };
  }
}
