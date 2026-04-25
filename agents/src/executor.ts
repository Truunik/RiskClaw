import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { PolicyUpdate } from "./types/risk.ts";

/// 0G Galileo testnet — chain id verified via cast on 2026-04-25.
/// We define this inline because viem doesn't ship a 0G entry yet.
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
    name: "updatePolicy",
    stateMutability: "nonpayable",
    inputs: [
      { name: "poolId", type: "bytes32" },
      { name: "riskScoreBps", type: "uint16" },
      { name: "dynamicFee", type: "uint24" },
      { name: "maxAbsAmountSpecified", type: "uint128" },
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
    outputs: [],
  },
  {
    type: "function",
    name: "approvedAgents",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

// Chain enforces a 2 gwei minimum priority fee — anything strictly above is fine.
const GAS_PRICE_WEI = 3_000_000_000n;

export interface ExecutorConfig {
  rpcUrl: string;
  registry: Address;
  privateKey: Hex;
  explorerUrl?: string;
}

export interface ExecutorResult {
  txHash: Hex;
  explorerUrl?: string;
}

export class Executor {
  private readonly account;
  private readonly chain;
  private readonly wallet;
  private readonly pub;
  private readonly registry: Address;

  constructor(config: ExecutorConfig) {
    this.account = privateKeyToAccount(config.privateKey);
    this.registry = config.registry;
    this.chain = {
      ...ogGalileo,
      rpcUrls: { default: { http: [config.rpcUrl] } },
      ...(config.explorerUrl
        ? { blockExplorers: { default: { name: "0G", url: config.explorerUrl } } }
        : {}),
    };
    this.wallet = createWalletClient({
      chain: this.chain,
      transport: http(config.rpcUrl),
      account: this.account,
    });
    this.pub = createPublicClient({ chain: this.chain, transport: http(config.rpcUrl) });
  }

  async submit(update: PolicyUpdate): Promise<ExecutorResult> {
    // Fail fast if this wallet isn't approved as an agent — saves a wasted tx.
    const approved = await this.pub.readContract({
      address: this.registry,
      abi: REGISTRY_ABI,
      functionName: "approvedAgents",
      args: [this.account.address],
    });
    if (!approved) {
      throw new Error(
        `Executor wallet ${this.account.address} is not an approved agent on ${this.registry}`,
      );
    }

    // viem expects bigint for uint64 calldata; our PolicyProof carries verifiedAt
    // as a number for ergonomics in JS-land. Convert at the boundary.
    const proofForAbi = { ...update.proof, verifiedAt: BigInt(update.proof.verifiedAt) };

    const txHash = await this.wallet.writeContract({
      address: this.registry,
      abi: REGISTRY_ABI,
      functionName: "updatePolicy",
      args: [
        update.poolId,
        update.riskScoreBps,
        update.dynamicFee,
        update.maxAbsAmountSpecified,
        proofForAbi,
      ],
      gasPrice: GAS_PRICE_WEI,
    });

    // Block until the tx is mined so we can confirm success and surface revert reasons cleanly.
    const receipt = await this.pub.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") {
      throw new Error(`updatePolicy reverted in tx ${txHash}`);
    }

    return {
      txHash,
      explorerUrl: this.chain.blockExplorers?.default
        ? `${this.chain.blockExplorers.default.url}/tx/${txHash}`
        : undefined,
    };
  }
}
