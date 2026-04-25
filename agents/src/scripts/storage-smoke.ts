import { ZeroGStorageMemory } from "../memory/zeroGMemory.ts";

/// Round-trip test: upload a memo → wait → download by root → compare bytes.
/// Run with `bun run agents/src/scripts/storage-smoke.ts`.
async function main() {
  const indexerUrl = required("OG_STORAGE_INDEXER_URL");
  const rpcUrl = required("OG_RPC_URL");
  const pk = required("DEPLOYER_PRIVATE_KEY");

  const mem = new ZeroGStorageMemory(indexerUrl, rpcUrl, pk);

  const payload = {
    test: "0G Storage round-trip",
    timestamp: new Date().toISOString(),
    nonce: Math.floor(Math.random() * 1e9),
  };
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  console.log("[upload]   bytes:", bytes.length);

  const t0 = Date.now();
  const root = await mem.upload(bytes);
  console.log("[upload]   root:", root, `(${Date.now() - t0}ms)`);

  const t1 = Date.now();
  const got = await mem.download(root);
  console.log("[download] bytes:", got.length, `(${Date.now() - t1}ms)`);

  const decoded = new TextDecoder().decode(got);
  const matches = decoded === JSON.stringify(payload);
  console.log("[verify]   match:", matches);
  if (!matches) {
    console.log("expected:", JSON.stringify(payload));
    console.log("got:     ", decoded);
    process.exit(1);
  }
  console.log("OK");
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
