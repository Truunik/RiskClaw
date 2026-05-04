import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Hex } from "viem";
import type { RegistryReader } from "./registry.js";
import type { StorageReader } from "./storage.js";

/// All RiskClaw MCP tools. Read-only by design — no signer, no writes.
///
/// Tool surface:
///   - get_pool_policy        → current onchain policy (mode, score, fee, proof roots)
///   - get_memo               → fetch the LLM risk memo from 0G Storage by root
///   - get_metrics            → fetch the Observer's pool metrics by root
///   - get_proof_artifact     → fetch the TEE attestation artifact by root
///   - explain_policy_modes   → reference card: what ALLOW / PENALTY_FEE / BLOCK mean

const Bytes32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "must be a 0x-prefixed 32-byte hex");
const PoolIdInput = z.object({
  poolId: Bytes32.optional().describe(
    "32-byte pool id from Uniswap v4 PoolKey.toId(). Falls back to DEFAULT_POOL_ID if unset.",
  ),
});

export interface Deps {
  registry: RegistryReader;
  storage: StorageReader;
  defaultPoolId?: Hex;
}

export function registerTools(server: McpServer, deps: Deps): void {
  registerGetPoolPolicy(server, deps);
  registerGetMemo(server, deps);
  registerGetMetrics(server, deps);
  registerGetProofArtifact(server, deps);
  registerExplainPolicyModes(server);
}

// ─────────────────────────────────────────────────────────────────────────────

function registerGetPoolPolicy(server: McpServer, deps: Deps): void {
  server.tool(
    "get_pool_policy",
    "Read the current RiskClaw policy for a Uniswap v4 pool from the onchain RiskPolicyRegistry. Returns the active mode (ALLOW / PENALTY_FEE / BLOCK), risk score, dynamic fee, and the proof roots that link back to the AI memo, TEE attestation, and metrics on 0G Storage.",
    PoolIdInput.shape,
    async ({ poolId }) => {
      const id = resolvePoolId(poolId, deps.defaultPoolId);
      const view = await deps.registry.getPolicy(id);
      return jsonResult(view);
    },
  );
}

function registerGetMemo(server: McpServer, deps: Deps): void {
  server.tool(
    "get_memo",
    "Fetch the AI risk memo from 0G Storage by its content-addressed root (typically the explanationRoot from get_pool_policy). The memo is the LLM's structured reasoning that justified the latest policy change: risk score, recommended fee, recommended swap cap, and the bullet-point reasoning.",
    {
      root: Bytes32.describe(
        "32-byte content root, typically `proof.explanationRoot` from get_pool_policy.",
      ),
    },
    async ({ root }) => {
      const data = await deps.storage.downloadJson(root as Hex);
      return jsonResult({ root, memo: data });
    },
  );
}

function registerGetMetrics(server: McpServer, deps: Deps): void {
  server.tool(
    "get_metrics",
    "Fetch the Observer's raw pool metrics snapshot from 0G Storage by its content-addressed root (proof.metricsRoot). These are the deterministic facts the LLM saw before producing the memo — TVL, drain flag, last-swap size, price impact, observation timestamp.",
    {
      root: Bytes32.describe("32-byte content root, typically `proof.metricsRoot` from get_pool_policy."),
    },
    async ({ root }) => {
      const data = await deps.storage.downloadJson(root as Hex);
      return jsonResult({ root, metrics: data });
    },
  );
}

function registerGetProofArtifact(server: McpServer, deps: Deps): void {
  server.tool(
    "get_proof_artifact",
    "Fetch the TEE compute-proof artifact from 0G Storage by its content-addressed root (proof.computeProofRoot). Contains the provider address, model id, response id, raw response hash, and the TEE verification result that signed off on the memo.",
    {
      root: Bytes32.describe(
        "32-byte content root, typically `proof.computeProofRoot` from get_pool_policy.",
      ),
    },
    async ({ root }) => {
      const data = await deps.storage.downloadJson(root as Hex);
      return jsonResult({ root, proofArtifact: data });
    },
  );
}

function registerExplainPolicyModes(server: McpServer): void {
  server.tool(
    "explain_policy_modes",
    "Reference card explaining what RiskClaw's policy modes mean and how the v4 hook enforces them. Useful when a user asks why their swap was blocked or charged an unusual fee.",
    {},
    async () => {
      const reference = {
        modes: {
          ALLOW: {
            score_band: "0 – 3999 bps",
            hook_behavior: "pass-through, baseline pool fee applies",
            user_meaning: "Pool is healthy. Normal swaps, normal fees.",
          },
          PENALTY_FEE: {
            score_band: "4000 – 8499 bps",
            hook_behavior:
              "beforeSwap returns OVERRIDE_FEE_FLAG | dynamicFee, replacing the baseline fee for this swap only",
            user_meaning:
              "Pool is degraded but live. Fee inflated to price out exploits and compensate LPs for risk.",
          },
          BLOCK: {
            score_band: "8500+ bps, OR proof is stale",
            hook_behavior: "beforeSwap and beforeAddLiquidity revert with PoolBlocked(poolId, riskScore)",
            user_meaning:
              "Pool is in a catastrophic state. Swaps and LP adds are temporarily disabled until risk drops.",
          },
        },
        thresholds: { PENALTY_THRESHOLD_BPS: 4000, BLOCK_THRESHOLD_BPS: 8500 },
        notes: [
          "All policy changes are signed onchain by an approved Guardian wallet.",
          "Each policy carries a PolicyProof committing the AI memo, TEE attestation, and metrics by 0G Storage root.",
          "isStale() returns true when the policy hasn't been refreshed within the registry's freshness window — the hook then treats the pool as BLOCK.",
        ],
      };
      return jsonResult(reference);
    },
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function resolvePoolId(supplied: string | undefined, fallback: Hex | undefined): Hex {
  const id = supplied ?? fallback;
  if (!id) {
    throw new Error(
      "No poolId supplied and DEFAULT_POOL_ID is not set. Pass poolId or set DEFAULT_POOL_ID in env.",
    );
  }
  return id as Hex;
}

function jsonResult(value: unknown) {
  const text = JSON.stringify(value, replacer, 2);
  return { content: [{ type: "text" as const, text }] };
}

function replacer(_key: string, value: unknown) {
  return typeof value === "bigint" ? value.toString() : value;
}
