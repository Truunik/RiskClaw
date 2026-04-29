import { createPublicClient, http, type Address, type Hex } from "viem";
import { ogGalileo } from "../executor.ts";

/// Companion to demo:explain. Reads the current PoolRiskPolicy from the
/// registry on 0G Galileo and prints it as ALLOW / PENALTY_FEE / BLOCK with
/// the proof roots and explorer links — the at-a-glance view a judge gets
/// after the agent loop has fired.

// BLOCK_THRESHOLD must match RiskHook.sol; PENALTY at 40% is a reasonable
// product-side cutoff above which we lean on a fee bump rather than a free swap.
const BLOCK_THRESHOLD = 8500;
const PENALTY_THRESHOLD = 4000;

const REGISTRY_ABI = [
  {
    type: "function",
    name: "getPolicy",
    stateMutability: "view",
    inputs: [{ name: "poolId", type: "bytes32" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "riskScoreBps", type: "uint16" },
          { name: "dynamicFee", type: "uint24" },
          { name: "maxAbsAmountSpecified", type: "uint128" },
          { name: "lastUpdated", type: "uint64" },
          { name: "updater", type: "address" },
          {
            name: "proof",
            type: "tuple",
            components: [
              { name: "explanationRoot", type: "bytes32" },
              { name: "computeProofRoot", type: "bytes32" },
              { name: "metricsRoot", type: "bytes32" },
              { name: "promptHash", type: "bytes32" },
              { name: "modelHash", type: "bytes32" },
              { name: "provider", type: "address" },
              { name: "responseIdHash", type: "bytes32" },
              { name: "verifiedAt", type: "uint64" },
            ],
          },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "isStale",
    stateMutability: "view",
    inputs: [{ name: "poolId", type: "bytes32" }],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

async function main() {
  const rpcUrl = required("OG_RPC_URL");
  const registry = required("RISK_POLICY_REGISTRY") as Address;
  const poolId = (process.argv[2] ?? process.env.POOL_ID) as Hex | undefined;
  if (!poolId || !/^0x[0-9a-fA-F]{64}$/.test(poolId)) {
    console.error("usage: bun run demo:state [<poolId>]   (or set POOL_ID in env)");
    process.exit(1);
  }
  const explorer = process.env.OG_EXPLORER_URL ?? ogGalileo.blockExplorers.default.url;

  const chain = { ...ogGalileo, rpcUrls: { default: { http: [rpcUrl] } } };
  const client = createPublicClient({ chain, transport: http(rpcUrl) });

  const [policy, stale] = await Promise.all([
    client.readContract({ address: registry, abi: REGISTRY_ABI, functionName: "getPolicy", args: [poolId] }),
    client.readContract({ address: registry, abi: REGISTRY_ABI, functionName: "isStale", args: [poolId] }),
  ]);

  const score = policy.riskScoreBps;
  const set = policy.lastUpdated > 0n;
  const mode = !set
    ? "UNSET"
    : stale
      ? "BLOCK (stale)"
      : score >= BLOCK_THRESHOLD
        ? "BLOCK"
        : score >= PENALTY_THRESHOLD
          ? "PENALTY_FEE"
          : "ALLOW";

  const lastUpdated = set ? Number(policy.lastUpdated) : 0;
  const verifiedAt = set ? Number(policy.proof.verifiedAt) : 0;
  const now = Math.floor(Date.now() / 1000);

  console.log("=== RiskClaw policy state ===");
  console.log(`registry      ${registry}`);
  console.log(`poolId        ${poolId}`);
  console.log("");
  console.log(`mode          ${mode}`);
  if (!set) {
    console.log("(no policy has been written for this pool yet — agent loop hasn't run)");
    return;
  }
  console.log(`risk score    ${score} / 10000`);
  console.log(`dynamic fee   ${policy.dynamicFee} pips  (${(Number(policy.dynamicFee) / 10_000).toFixed(2)}%)`);
  console.log(`max swap      ${policy.maxAbsAmountSpecified === 0n ? "(unlimited)" : policy.maxAbsAmountSpecified.toString()}`);
  console.log(`stale         ${stale}`);
  console.log("");
  console.log(`last updated  ${tsLine(lastUpdated, now)}  by ${policy.updater}`);
  console.log(`tee verified  ${tsLine(verifiedAt, now)}  by ${policy.proof.provider}`);
  console.log("");
  console.log("--- proof roots (fetch with: bun run demo:explain <root>) ---");
  console.log(`explanationRoot   ${policy.proof.explanationRoot}`);
  console.log(`computeProofRoot  ${policy.proof.computeProofRoot}`);
  console.log(`metricsRoot       ${policy.proof.metricsRoot}`);
  console.log(`promptHash        ${policy.proof.promptHash}`);
  console.log(`modelHash         ${policy.proof.modelHash}`);
  console.log(`responseIdHash    ${policy.proof.responseIdHash}`);
  console.log("");
  console.log(`explorer          ${explorer}/address/${registry}`);
}

function tsLine(unix: number, now: number): string {
  if (unix === 0) return "(never)";
  const iso = new Date(unix * 1000).toISOString();
  const delta = now - unix;
  const rel =
    delta < 60
      ? `${delta}s ago`
      : delta < 3600
        ? `${Math.floor(delta / 60)}m ago`
        : delta < 86_400
          ? `${Math.floor(delta / 3600)}h ago`
          : `${Math.floor(delta / 86_400)}d ago`;
  return `${iso}  (${rel})`;
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
