#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { RegistryReader } from "./registry.js";
import { StorageReader } from "./storage.js";
import { registerTools } from "./tools.js";

/// RiskClaw MCP — read-only window into the live policy state and the 0G
/// Storage proof chain. Wire it into Claude Desktop (or any MCP client) and
/// any LLM agent can ask "what's the current risk policy on pool X?" before
/// recommending a swap to a user.

async function main() {
  const config = loadConfig();
  const registry = new RegistryReader(config.rpcUrl, config.registry, config.explorerUrl);
  const storage = new StorageReader(config.storageIndexerUrl);

  const server = new McpServer({
    name: "riskclaw",
    version: "0.1.0",
  });

  registerTools(server, { registry, storage, defaultPoolId: config.defaultPoolId });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // The MCP SDK keeps the process alive on the stdio transport; nothing else to do.
}

main().catch((err) => {
  // stderr is the only place we can report failures — stdout is reserved for
  // the MCP JSON-RPC framing.
  console.error("riskclaw mcp fatal:", err);
  process.exit(1);
});
