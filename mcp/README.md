# RiskClaw MCP

Read-only [Model Context Protocol](https://modelcontextprotocol.io) server that exposes RiskClaw's live policy state and 0G Storage audit chain to any LLM agent.

> Wire this into Claude Desktop (or any MCP-aware client) and your AI assistant can ask **"what's the current risk policy on pool X?"** before recommending a swap to a user — pulling the answer straight from the onchain registry and the 0G Storage memos that justified it.

This server is **read-only**. It cannot trigger an agent loop, sign a transaction, or modify policy. To write a policy, run the agent loop in [`/agents`](../agents/).

## Tool surface

| Tool                    | What it does                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------- |
| `get_pool_policy`       | Read the current onchain policy for a pool: mode (ALLOW / PENALTY_FEE / BLOCK), risk score, fee, proof roots. |
| `get_memo`              | Fetch the AI risk memo from 0G Storage by `explanationRoot`.                                                  |
| `get_metrics`           | Fetch the Observer's raw pool metrics by `metricsRoot`.                                                       |
| `get_proof_artifact`    | Fetch the TEE compute-proof artifact by `computeProofRoot`.                                                   |
| `explain_policy_modes`  | Reference card: what each mode means, score thresholds, hook behavior.                                        |

## Quick start

```bash
cd mcp
npm install
cp .env.example .env       # defaults already point at the live testnet deployment
npm run build
npm run start              # starts an MCP stdio server
```

Or for development without the build step:

```bash
npm run dev                # tsx-driven, no compile
```

The server speaks MCP over stdio — it doesn't print anything to stdout on startup. If you need to verify it's healthy, attach an MCP client (see below).

## Connecting to Claude Desktop

Add an entry to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "riskclaw": {
      "command": "node",
      "args": ["/absolute/path/to/RiskClaw/mcp/dist/server.js"],
      "env": {
        "OG_RPC_URL": "https://evmrpc-testnet.0g.ai",
        "RISK_POLICY_REGISTRY": "0x804b7Df3814c6ba5A47E93043EA8da66a21B9351",
        "OG_STORAGE_INDEXER_URL": "https://indexer-storage-testnet-turbo.0g.ai"
      }
    }
  }
}
```

Restart Claude Desktop. The five tools above will appear in the tool picker.

> Prefer `tsx` over a build step? Replace `command` with `npx` and `args` with `["tsx", "/absolute/path/to/RiskClaw/mcp/src/server.ts"]`.

## Configuration

| Env var                  | Required | Default                                      | Purpose                                          |
| ------------------------ | -------- | -------------------------------------------- | ------------------------------------------------ |
| `OG_RPC_URL`             | yes      | `https://evmrpc-testnet.0g.ai`               | 0G Galileo RPC endpoint.                         |
| `RISK_POLICY_REGISTRY`   | yes      | `0x804b7Df3...B9351`                         | Live registry on 0G Galileo.                     |
| `OG_STORAGE_INDEXER_URL` | yes      | `https://indexer-storage-testnet-turbo.0g.ai`| 0G Storage indexer for content-root downloads.   |
| `OG_EXPLORER_URL`        | no       | `https://chainscan-galileo.0g.ai`            | Used for human-readable explorer links.          |
| `DEFAULT_POOL_ID`        | no       | —                                            | Pool id used when a tool is called without one.  |

## How the data flows

```
LLM agent (Claude / etc.)
        │
        ▼ MCP tool call
RiskClaw MCP (this package)
        │
        ├── viem.readContract → RiskPolicyRegistry on 0G Galileo
        │                       (mode, score, fee, proof roots)
        │
        └── Indexer.downloadToBlob → 0G Storage
                                     (memo / metrics / TEE artifact by content root)
```

Nothing here writes to the chain. The registry is updated only by the Guardian wallet running in the agent loop.

## Pitch framing — "we are here, MCP is the next step"

The MCP package is the user-facing surface for RiskClaw:

- **Pool deployers / DeFi protocols** integrate at the contract layer — attach `RiskHook`, run an agent loop, and pool risk becomes self-governing.
- **End users** never call this MCP themselves. Their AI assistant does — silently — before recommending a swap. *"The pool is in penalty mode at 10% — I'd wait or use a different venue."*

The agent loop is the brain. The hook is the muscle. The MCP is the eyes any third-party LLM uses to see what the brain just decided.

## Troubleshooting

- **`missing env: ...`** — copy `.env.example` to `.env` or supply the variable in the MCP client config.
- **`Content at root ... is not valid JSON`** — the root you passed exists on 0G Storage but isn't a JSON document. Most likely you passed a `promptHash` / `modelHash` / `responseIdHash` (those are commitments, not storage roots). Use `explanationRoot`, `metricsRoot`, or `computeProofRoot`.
- **`0G Storage download failed`** — the indexer occasionally rate-limits. Retry; if persistent, switch indexer URL.
- **Empty `getPolicy` (mode = `UNSET`)** — no policy has been written yet for that poolId. Run the agent loop in `/agents` once to populate it.

## License

MIT — see repo root.
