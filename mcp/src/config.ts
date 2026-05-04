import type { Address, Hex } from "viem";

/// Single source of truth for env-driven config. The MCP is read-only by
/// design — no signer, no private key. If you need to *write* a policy, run
/// the agent loop in `/agents`, not this server.
export interface Config {
  rpcUrl: string;
  registry: Address;
  storageIndexerUrl: string;
  explorerUrl: string;
  defaultPoolId?: Hex;
}

export function loadConfig(): Config {
  const rpcUrl = required("OG_RPC_URL");
  const registry = required("RISK_POLICY_REGISTRY");
  const storageIndexerUrl = required("OG_STORAGE_INDEXER_URL");
  const explorerUrl = process.env.OG_EXPLORER_URL ?? "https://chainscan-galileo.0g.ai";
  const defaultPoolId = process.env.DEFAULT_POOL_ID;

  if (!isAddress(registry)) {
    throw new Error(`RISK_POLICY_REGISTRY is not a valid address: ${registry}`);
  }
  if (defaultPoolId && !isBytes32(defaultPoolId)) {
    throw new Error(`DEFAULT_POOL_ID is not a 32-byte hex: ${defaultPoolId}`);
  }

  return {
    rpcUrl,
    registry: registry as Address,
    storageIndexerUrl,
    explorerUrl,
    defaultPoolId: defaultPoolId as Hex | undefined,
  };
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env: ${name}`);
  return v;
}

function isAddress(s: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(s);
}

function isBytes32(s: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(s);
}
