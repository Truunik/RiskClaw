import type { Address, Hex } from "viem";
import { createZGComputeNetworkBroker } from "@0glabs/0g-serving-broker";
import { JsonRpcProvider, Wallet } from "ethers";
import { Observer, type RawPoolSnapshot } from "./observer.ts";
import { Analyst } from "./analyst.ts";
import { Guardian } from "./guardian.ts";
import { Executor } from "./executor.ts";
import { InMemoryZeroGMemory, ZeroGStorageMemory, type ZeroGMemory } from "./memory/zeroGMemory.ts";
import {
  HeuristicZeroGCompute,
  RealZeroGCompute,
  type ZeroGCompute,
} from "./compute/zeroGCompute.ts";

/// End-to-end pipeline: Observer → Analyst → Guardian → Executor.
/// Backends are picked from env so the same loop runs locally (in-memory +
/// heuristic) or against real 0G testnet (Storage + Compute + onchain registry).
async function main() {
  const memory: ZeroGMemory = process.env.OG_STORAGE_INDEXER_URL
    ? new ZeroGStorageMemory(
        process.env.OG_STORAGE_INDEXER_URL,
        process.env.OG_RPC_URL!,
        process.env.DEPLOYER_PRIVATE_KEY!,
      )
    : new InMemoryZeroGMemory();
  console.log("[memory]    backend:", memory.constructor.name);

  const computeBaseConfig = {
    providerAddress: (process.env.OG_COMPUTE_PROVIDER_ADDRESS ??
      "0xCAFE000000000000000000000000000000000000") as Hex,
    model: process.env.OG_COMPUTE_MODEL ?? "qwen-2.5-7b-instruct",
    verify: process.env.OG_COMPUTE_VERIFY !== "false",
  };
  const useRealCompute =
    process.env.OG_COMPUTE_PROVIDER_ADDRESS &&
    process.env.OG_RPC_URL &&
    process.env.DEPLOYER_PRIVATE_KEY &&
    process.env.OG_COMPUTE_BACKEND !== "heuristic";
  const compute: ZeroGCompute = useRealCompute
    ? new RealZeroGCompute({
        ...computeBaseConfig,
        rpcUrl: process.env.OG_RPC_URL!,
        privateKey: process.env.DEPLOYER_PRIVATE_KEY!,
      })
    : new HeuristicZeroGCompute(computeBaseConfig);
  console.log("[compute]   backend:", compute.constructor.name, "model:", computeBaseConfig.model);

  const observer = new Observer(memory);
  const analyst = new Analyst(compute, memory);
  const guardian = new Guardian(memory, compute);

  const executor = process.env.RISK_POLICY_REGISTRY
    ? new Executor({
        rpcUrl: process.env.OG_RPC_URL!,
        registry: process.env.RISK_POLICY_REGISTRY as Address,
        privateKey: process.env.DEPLOYER_PRIVATE_KEY! as Hex,
        explorerUrl: process.env.OG_EXPLORER_URL,
      })
    : null;
  console.log("[executor]  backend:", executor ? "onchain" : "dry-run");

  const poolId = (process.env.POOL_ID ??
    "0x1111111111111111111111111111111111111111111111111111111111111111") as Hex;

  const scenario: RawPoolSnapshot = {
    tvl: 5_000_000n * 10n ** 18n,
    tvlDelta24hBps: 7400,
    isDrain: true,
    lastSwapAmountBps: 1800,
    priceImpactBps: 620,
  };

  const { metrics, root: metricsRoot } = await observer.observe(poolId, scenario);
  console.log("[Observer]  metrics root", metricsRoot);

  const { verified, explanationRoot } = await analyst.analyze(metrics);
  console.log("[Analyst]   memo root   ", explanationRoot);
  console.log("[Analyst]   risk score  ", verified.memo.riskScoreBps);
  console.log("[Analyst]   reasoning   ", verified.memo.reasoning);
  console.log("[Analyst]   provider    ", verified.provider);
  console.log("[Analyst]   responseId  ", verified.responseId);
  console.log("[Analyst]   TEE verified", verified.verificationResult);

  const update = await guardian.decide(poolId, verified, explanationRoot, metricsRoot);
  if (!update) {
    console.log("[Guardian]  REJECTED — guardrails tripped");
    return;
  }
  console.log("[Guardian]  policy update");
  console.log("            score                  ", update.riskScoreBps);
  console.log("            fee                    ", update.dynamicFee);
  console.log("            maxAbsAmountSpecified  ", update.maxAbsAmountSpecified.toString());
  console.log("            proof.explanationRoot  ", update.proof.explanationRoot);
  console.log("            proof.computeProofRoot ", update.proof.computeProofRoot);
  console.log("            proof.metricsRoot      ", update.proof.metricsRoot);

  if (!executor) {
    console.log("[Executor]  dry-run — set RISK_POLICY_REGISTRY in env to broadcast");
    return;
  }

  const t = Date.now();
  const result = await executor.submit(update);
  console.log(`[Executor]  tx       ${result.txHash}`);
  if (result.explorerUrl) console.log(`[Executor]  explorer ${result.explorerUrl}`);
  console.log(`[Executor]  confirmed in ${Date.now() - t}ms`);

  // Post-run ledger snapshot — useful so a re-run tells us how much the
  // Compute call burned. Best-effort: never fail the run on a read error.
  if (useRealCompute) {
    try {
      const provider = new JsonRpcProvider(process.env.OG_RPC_URL!);
      const wallet = new Wallet(process.env.DEPLOYER_PRIVATE_KEY!, provider);
      const broker = await createZGComputeNetworkBroker(wallet);
      const ledger = await broker.ledger.getLedger();
      const total = Number(ledger.totalBalance) / 1e18;
      const avail = Number(ledger.availableBalance) / 1e18;
      console.log(`[Ledger]    total ${total.toFixed(6)} 0G  available ${avail.toFixed(6)} 0G`);
    } catch (e) {
      console.log("[Ledger]    skipped:", e instanceof Error ? e.message : String(e));
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
