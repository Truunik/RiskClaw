import { createZGComputeNetworkReadOnlyBroker } from "@0glabs/0g-serving-broker";

/// Read-only listing of all 0G Compute providers + their models. No wallet, no gas.
async function main() {
  const rpcUrl = process.env.OG_RPC_URL ?? "https://evmrpc-testnet.0g.ai";
  const broker = await createZGComputeNetworkReadOnlyBroker(rpcUrl);
  const services = await broker.inference.listService();

  console.log(`found ${services.length} provider(s) on ${rpcUrl}\n`);
  for (const s of services) {
    console.log(`provider:           ${s.provider}`);
    console.log(`  model:            ${s.model}`);
    console.log(`  serviceType:      ${s.serviceType}`);
    console.log(`  url:              ${s.url}`);
    console.log(`  verifiability:    ${s.verifiability}`);
    console.log(`  teeAcknowledged:  ${s.teeSignerAcknowledged}`);
    console.log(`  inputPrice:       ${s.inputPrice}`);
    console.log(`  outputPrice:      ${s.outputPrice}`);
    console.log("");
  }

  const target = process.env.OG_COMPUTE_MODEL ?? "qwen/qwen-2.5-7b-instruct";
  const match = services.find((s) => s.model === target && s.teeSignerAcknowledged);
  if (match) {
    console.log(`✓ matched ${target}: provider=${match.provider} verifiability=${match.verifiability}`);
  } else {
    console.log(`✗ no acknowledged provider serving "${target}"`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
