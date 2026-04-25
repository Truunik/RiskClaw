import type { Hex } from "./types/risk.ts";
import { Observer, type RawPoolSnapshot } from "./observer.ts";
import { Analyst } from "./analyst.ts";
import { Guardian } from "./guardian.ts";
import { InMemoryZeroGMemory } from "./memory/zeroGMemory.ts";
import { HeuristicZeroGCompute } from "./compute/zeroGCompute.ts";

/// End-to-end pipeline runner — Observer → Analyst → Guardian → (executor tx).
/// The executor tx is logged here, not sent; src/executor.ts (next iteration)
/// will sign and submit to RiskPolicyRegistry on 0G testnet.
async function main() {
  const memory = new InMemoryZeroGMemory();
  const compute = new HeuristicZeroGCompute({
    providerAddress: (process.env.OG_COMPUTE_PROVIDER_ADDRESS ?? "0xCAFE000000000000000000000000000000000000") as Hex,
    model: process.env.OG_COMPUTE_MODEL ?? "qwen-2.5-7b-instruct",
    verify: process.env.OG_COMPUTE_VERIFY !== "false",
  });

  const observer = new Observer(memory);
  const analyst = new Analyst(compute, memory);
  const guardian = new Guardian(memory);

  const poolId = "0x1111111111111111111111111111111111111111111111111111111111111111" as Hex;

  const scenario: RawPoolSnapshot = {
    tvl: 5_000_000n * 10n ** 18n,
    tvlDelta24hBps: 7400,
    isDrain: true,
    lastSwapAmountBps: 1800,
    priceImpactBps: 620,
  };

  const { metrics, root } = await observer.observe(poolId, scenario);
  console.log("[Observer]  metrics root", root);

  const { verified, explanationRoot } = await analyst.analyze(metrics);
  console.log("[Analyst]   memo root   ", explanationRoot);
  console.log("[Analyst]   risk score  ", verified.memo.riskScoreBps);
  console.log("[Analyst]   reasoning   ", verified.memo.reasoning);

  const update = await guardian.decide(poolId, verified, explanationRoot);
  if (!update) {
    console.log("[Guardian]  REJECTED — guardrails tripped");
    return;
  }
  console.log("[Guardian]  policy update");
  console.log("            score   ", update.riskScoreBps);
  console.log("            fee     ", update.dynamicFee);
  console.log("            maxSwap ", update.maxSwapBps);
  console.log("            proof.explanationRoot ", update.proof.explanationRoot);
  console.log("            proof.computeProofRoot", update.proof.computeProofRoot);
  console.log("[Executor]  TODO: send updatePolicy(...) to RiskPolicyRegistry on 0G");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
