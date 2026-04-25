import { ZeroGStorageMemory } from "../memory/zeroGMemory.ts";
import type { Hex } from "../types/risk.ts";

/// Fetch a memo or proof artifact from 0G Storage by its root and pretty-print it.
/// This is the demo's signature moment: a judge clicks the explanationRoot from
/// the on-chain PolicyUpdated event, runs `bun run demo:explain <root>`, and
/// reads the LLM's reasoning that justified the policy change.
async function main() {
  const root = process.argv[2];
  if (!root || !/^0x[0-9a-fA-F]{64}$/.test(root)) {
    console.error("usage: bun run demo:explain <0x-prefixed 32-byte root>");
    process.exit(1);
  }

  const indexerUrl = required("OG_STORAGE_INDEXER_URL");
  const rpcUrl = required("OG_RPC_URL");
  const pk = required("DEPLOYER_PRIVATE_KEY");

  const mem = new ZeroGStorageMemory(indexerUrl, rpcUrl, pk);
  const bytes = await mem.download(root as Hex);
  const text = new TextDecoder().decode(bytes);

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    console.log("--- raw bytes ---");
    console.log(text);
    return;
  }

  console.log("=== fetched from 0G Storage ===");
  console.log("root:", root);
  console.log("size:", bytes.length, "bytes");
  console.log();
  prettyPrint(data);
}

function prettyPrint(data: unknown) {
  if (!isObject(data)) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  // Memo shape (RiskMemo): has reasoning + observations
  if ("reasoning" in data && Array.isArray((data as { reasoning: unknown[] }).reasoning)) {
    const memo = data as {
      riskScoreBps: number;
      recommendedFee: number;
      recommendedMaxAbsAmount: string | number;
      reasoning: string[];
      observations: Record<string, unknown>;
    };
    console.log("--- Risk memo ---");
    console.log(`risk score:        ${memo.riskScoreBps} / 10000`);
    console.log(`recommended fee:   ${(memo.recommendedFee / 10_000).toFixed(2)}%`);
    console.log(`recommended cap:   ${memo.recommendedMaxAbsAmount}`);
    console.log("\nreasoning:");
    for (const line of memo.reasoning) console.log(`  • ${line}`);
    console.log("\nobservations:");
    for (const [k, v] of Object.entries(memo.observations)) console.log(`  ${k}: ${v}`);
    return;
  }

  // Proof artifact shape: has provider + verificationResult
  if ("provider" in data && "verificationResult" in data) {
    console.log("--- Compute proof artifact ---");
    for (const [k, v] of Object.entries(data)) console.log(`  ${k}: ${v}`);
    return;
  }

  // Fall back to JSON dump
  console.log(JSON.stringify(data, null, 2));
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`missing env: ${name}`);
    process.exit(1);
  }
  return v;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
