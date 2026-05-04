import { createPublicClient, defineChain, http, type Address, type Hex } from "viem";

/// Read-only client for the RiskPolicyRegistry on 0G Galileo. Mirrors the ABI
/// and threshold constants used by `agents/src/scripts/demo-state.ts` so the
/// MCP and the canonical demo agree on what each mode means.

// Must match RiskHook.sol. Above BLOCK_THRESHOLD the hook reverts; above
// PENALTY_THRESHOLD it applies the dynamic-fee override; below, it passes.
const BLOCK_THRESHOLD = 8500;
const PENALTY_THRESHOLD = 4000;

export type PolicyMode = "ALLOW" | "PENALTY_FEE" | "BLOCK" | "BLOCK (stale)" | "UNSET";

export const ogGalileo = defineChain({
  id: 16602,
  name: "0G Galileo Testnet",
  nativeCurrency: { name: "0G", symbol: "0G", decimals: 18 },
  rpcUrls: { default: { http: ["https://evmrpc-testnet.0g.ai"] } },
  blockExplorers: {
    default: { name: "0G ChainScan Galileo", url: "https://chainscan-galileo.0g.ai" },
  },
});

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

export interface PolicyView {
  poolId: Hex;
  mode: PolicyMode;
  riskScoreBps: number;
  dynamicFeePips: number;
  dynamicFeePct: number;
  maxAbsAmountSpecified: string;
  lastUpdatedUnix: number;
  updater: Address;
  stale: boolean;
  proof: {
    explanationRoot: Hex;
    computeProofRoot: Hex;
    metricsRoot: Hex;
    promptHash: Hex;
    modelHash: Hex;
    provider: Address;
    responseIdHash: Hex;
    verifiedAtUnix: number;
  };
  explorer: {
    registry: string;
  };
}

export class RegistryReader {
  private client;

  constructor(
    private rpcUrl: string,
    private registry: Address,
    private explorerUrl: string,
  ) {
    const chain = { ...ogGalileo, rpcUrls: { default: { http: [rpcUrl] } } };
    this.client = createPublicClient({ chain, transport: http(rpcUrl) });
  }

  async getPolicy(poolId: Hex): Promise<PolicyView> {
    const [policy, stale] = await Promise.all([
      this.client.readContract({
        address: this.registry,
        abi: REGISTRY_ABI,
        functionName: "getPolicy",
        args: [poolId],
      }),
      this.client.readContract({
        address: this.registry,
        abi: REGISTRY_ABI,
        functionName: "isStale",
        args: [poolId],
      }),
    ]);

    const set = policy.lastUpdated > 0n;
    const score = policy.riskScoreBps;
    const mode: PolicyMode = !set
      ? "UNSET"
      : stale
        ? "BLOCK (stale)"
        : score >= BLOCK_THRESHOLD
          ? "BLOCK"
          : score >= PENALTY_THRESHOLD
            ? "PENALTY_FEE"
            : "ALLOW";

    return {
      poolId,
      mode,
      riskScoreBps: score,
      dynamicFeePips: Number(policy.dynamicFee),
      dynamicFeePct: Number(policy.dynamicFee) / 10_000,
      maxAbsAmountSpecified: policy.maxAbsAmountSpecified.toString(),
      lastUpdatedUnix: Number(policy.lastUpdated),
      updater: policy.updater,
      stale,
      proof: {
        explanationRoot: policy.proof.explanationRoot,
        computeProofRoot: policy.proof.computeProofRoot,
        metricsRoot: policy.proof.metricsRoot,
        promptHash: policy.proof.promptHash,
        modelHash: policy.proof.modelHash,
        provider: policy.proof.provider,
        responseIdHash: policy.proof.responseIdHash,
        verifiedAtUnix: Number(policy.proof.verifiedAt),
      },
      explorer: {
        registry: `${this.explorerUrl}/address/${this.registry}`,
      },
    };
  }
}
