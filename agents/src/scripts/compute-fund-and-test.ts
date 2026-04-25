import { createZGComputeNetworkBroker } from "@0glabs/0g-serving-broker";
import { JsonRpcProvider, Wallet } from "ethers";

/// One-shot end-to-end test: ensure ledger exists (funds 0.01 0G if not),
/// list services, pick the configured model, run a tiny chat completion,
/// verify the TEE signature via processResponse, print everything.
const FUND_AMOUNT_OG = 0.01;
const GAS_PRICE_NEURON = 3_000_000_000; // 3 gwei — chain min is 2 gwei strict

async function main() {
  const rpcUrl = required("OG_RPC_URL");
  const pk = required("DEPLOYER_PRIVATE_KEY");
  const targetModel = required("OG_COMPUTE_MODEL");

  const provider = new JsonRpcProvider(rpcUrl);
  const wallet = new Wallet(pk, provider);
  console.log("wallet:", wallet.address);

  const broker = await createZGComputeNetworkBroker(
    wallet,
    undefined,
    undefined,
    undefined,
    GAS_PRICE_NEURON,
  );

  // ---- Step 1: ledger ----
  let hasLedger = true;
  try {
    const l = await broker.ledger.getLedger();
    console.log("[ledger] exists. balance:", l.totalBalance.toString(), "neuron");
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (
      msg.toLowerCase().includes("account does not exist") ||
      msg.toLowerCase().includes("not found") ||
      msg.toLowerCase().includes("no ledger")
    ) {
      hasLedger = false;
      console.log("[ledger] none — funding", FUND_AMOUNT_OG, "0G");
      await broker.ledger.addLedger(FUND_AMOUNT_OG, GAS_PRICE_NEURON);
      const l = await broker.ledger.getLedger();
      console.log("[ledger] funded. balance:", l.totalBalance.toString(), "neuron");
    } else {
      throw e;
    }
  }

  // ---- Step 2: pick provider ----
  const services = await broker.inference.listService();
  const svc = services.find((s) => s.model === targetModel && s.teeSignerAcknowledged);
  if (!svc) throw new Error(`no acknowledged provider serving ${targetModel}`);
  const providerAddress = svc.provider;
  console.log("[provider]", providerAddress, "→", svc.model, "(verifiability:", svc.verifiability + ")");

  // ---- Step 3: service metadata ----
  const { endpoint, model } = await broker.inference.getServiceMetadata(providerAddress);
  console.log("[metadata] endpoint:", endpoint);
  console.log("[metadata] model:   ", model);

  // ---- Step 4: signed billing headers ----
  const userContent = "What is 2 + 2? Answer with one digit only.";
  const headers = await broker.inference.getRequestHeaders(providerAddress, userContent);

  // ---- Step 5: chat completion ----
  const url = `${endpoint.replace(/\/$/, "")}/v1/chat/completions`;
  console.log("[request]  POST", url);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(headers as unknown as Record<string, string>) },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: userContent }],
      max_tokens: 16,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`provider returned ${res.status}: ${text}`);
  }
  const data = (await res.json()) as {
    id?: string;
    choices?: { message?: { content?: string } }[];
    usage?: unknown;
  };
  const chatID = res.headers.get("ZG-Res-Key") ?? data.id;
  const answer = data.choices?.[0]?.message?.content ?? "(no content)";
  console.log("[response] chatID:", chatID);
  console.log("[response] answer:", answer);
  console.log("[response] usage: ", JSON.stringify(data.usage));

  // ---- Step 6: TEE verify ----
  if (!chatID) {
    console.log("[verify]   skipped — no chatID");
    return;
  }
  const valid = await broker.inference.processResponse(
    providerAddress,
    chatID,
    JSON.stringify(data.usage ?? {}),
  );
  console.log("[verify]   TEE valid:", valid);

  if (valid !== true) {
    console.log("\n⚠  TEE verification failed — investigate before wiring into agent loop");
    process.exit(1);
  }
  console.log("\nOK: full Compute round-trip + TEE verification passed");
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
  console.error("smoke test failed:", e);
  process.exit(1);
});
