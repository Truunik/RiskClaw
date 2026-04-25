import { createZGComputeNetworkBroker } from "@0glabs/0g-serving-broker";
import { JsonRpcProvider, Wallet } from "ethers";

/// Reads the wallet's 0G Compute ledger. Read-only, no tx.
async function main() {
  const rpcUrl = required("OG_RPC_URL");
  const pk = required("DEPLOYER_PRIVATE_KEY");

  const provider = new JsonRpcProvider(rpcUrl);
  const wallet = new Wallet(pk, provider);
  console.log("wallet:", wallet.address);

  const broker = await createZGComputeNetworkBroker(wallet);

  try {
    const ledger = await broker.ledger.getLedger();
    console.log("ledger:    EXISTS");
    console.log("  user:           ", ledger.user);
    console.log("  totalBalance:   ", ledger.totalBalance.toString(), "neuron");
    console.log("  availableBalance:", ledger.availableBalance.toString(), "neuron");
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.toLowerCase().includes("not found") || msg.toLowerCase().includes("no ledger")) {
      console.log("ledger:    NONE");
      console.log("  next:    broker.ledger.addLedger(0.01) — costs ~0.01 0G + tx fee");
    } else {
      console.error("getLedger failed:", msg);
      process.exit(1);
    }
  }
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
