import { keccak256, toBytes } from "viem";
import type { Hex, PoolMetrics, RiskMemo, VerifiedMemo } from "../types/risk.ts";
import { createZGComputeNetworkBroker } from "@0glabs/0g-serving-broker";
import { JsonRpcProvider, Wallet } from "ethers";

/// Wrapper around 0G Compute inference. Returns the raw memo plus the TEE
/// verification artifacts (response id, signature, verification result) the
/// Guardian commits onchain.
export interface ZeroGCompute {
  analyze(metrics: PoolMetrics): Promise<VerifiedMemo>;
  promptHash(): Hex;
  modelHash(): Hex;
}

export interface ZeroGComputeConfig {
  providerAddress: Hex;
  model: string;
  verify: boolean;
}

const PROMPT_TEMPLATE = `You are a DeFi risk analyst for a Uniswap v4-style liquidity pool on 0G.

You receive pool metrics as JSON and reply with EXACTLY one JSON object and nothing else (no prose, no code fence). Schema:

{
  "riskScoreBps": <integer 0..10000>,
  "recommendedFee": <integer 0..100000, pips, 10000 = 1.00%>,
  "recommendedMaxAbsAmount": <decimal-integer string in raw token units, "0" for no cap>,
  "reasoning": [<short string>, ...]   // 2-5 bullets, each under 90 chars
}

Calibration:
- riskScoreBps < 4000  -> ALLOW       (baseline fee, no cap)
- 4000..7000           -> PENALTY_FEE (raise fee, optional cap)
- > 7000               -> BLOCK-grade (high fee + tight cap)

Be conservative. > 50% TVL drained in 24h is severe. High lastSwapAmountBps and priceImpactBps both push score up.`;

/// Heuristic stand-in. Replace .analyze() with a 0G Compute call once the
/// provider/model are configured; keep the same return shape so the rest of
/// the pipeline doesn't change.
export class HeuristicZeroGCompute implements ZeroGCompute {
  constructor(private config: ZeroGComputeConfig) {}

  promptHash(): Hex {
    return keccak256(toBytes(PROMPT_TEMPLATE));
  }
  modelHash(): Hex {
    return keccak256(toBytes(this.config.model));
  }

  async analyze(metrics: PoolMetrics): Promise<VerifiedMemo> {
    const reasoning: string[] = [];
    let score = 0;

    if (metrics.isDrain && metrics.tvlDelta24hBps > 5000) {
      score += 4500;
      reasoning.push(`${(metrics.tvlDelta24hBps / 100).toFixed(1)}% liquidity drained in 24h`);
    }
    if (metrics.lastSwapAmountBps > 1500) {
      score += 2000;
      reasoning.push(`swap size ${(metrics.lastSwapAmountBps / 100).toFixed(1)}% of active liquidity`);
    }
    if (metrics.priceImpactBps > 500) {
      score += 1500;
      reasoning.push(`price impact ${(metrics.priceImpactBps / 100).toFixed(1)}% exceeds threshold`);
    }
    score = Math.min(score, 9999);

    const recommendedFee = score >= 7000 ? 30_000 : score >= 4000 ? 10_000 : 3_000;
    // Absolute swap cap. Tightens as risk rises. Scales relative to TVL so the
    // cap means something even on small pools; a real 0G Compute version can
    // reason about token decimals + active liquidity properly.
    const tvlFraction = score >= 7000 ? 50n : score >= 4000 ? 200n : 0n; // bps; 0 = no cap
    const recommendedMaxAbsAmount = tvlFraction === 0n ? 0n : (metrics.tvl * tvlFraction) / 10_000n;

    if (reasoning.length === 0) reasoning.push("pool nominal");
    reasoning.push(`recommended fee: ${(recommendedFee / 10_000).toFixed(2)}%`);

    const memo: RiskMemo = {
      riskScoreBps: score,
      recommendedFee,
      recommendedMaxAbsAmount,
      reasoning,
      observations: metrics,
    };

    const memoJson = JSON.stringify(memo, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    const rawResponseHash = keccak256(toBytes(memoJson));

    return {
      memo,
      provider: this.config.providerAddress,
      model: this.config.model,
      responseId: `zg-res-${Date.now()}`,
      rawResponseHash,
      teeSignature: ("0x" + "00".repeat(65)) as Hex,
      verificationResult: this.config.verify,
      verifiedAt: Math.floor(Date.now() / 1000),
    };
  }
}

export interface RealZeroGComputeConfig extends ZeroGComputeConfig {
  rpcUrl: string;
  privateKey: string;
  /// 3 gwei — chain enforces a strict 2 gwei minimum. Used by the broker for
  /// any onchain billing settlement transactions.
  gasPriceWei?: number;
}

/// Live 0G Compute backend. Uses @0glabs/0g-serving-broker to:
///   1. fetch the provider's service metadata (endpoint, model)
///   2. produce signed billing headers committing to the user content
///   3. POST to the TEE-backed chat completions endpoint
///   4. verify the ZG-Res-Key signature via processResponse()
/// Returns the parsed RiskMemo plus the full TEE attestation chain — which
/// the Guardian then bundles into the onchain PolicyProof.
export class RealZeroGCompute implements ZeroGCompute {
  private brokerPromise: ReturnType<typeof createZGComputeNetworkBroker> | null = null;
  private metadataPromise: Promise<{ endpoint: string; model: string }> | null = null;
  private readonly wallet: Wallet;

  constructor(private readonly config: RealZeroGComputeConfig) {
    const provider = new JsonRpcProvider(config.rpcUrl);
    this.wallet = new Wallet(config.privateKey, provider);
  }

  promptHash(): Hex {
    return keccak256(toBytes(PROMPT_TEMPLATE));
  }
  modelHash(): Hex {
    return keccak256(toBytes(this.config.model));
  }

  async analyze(metrics: PoolMetrics): Promise<VerifiedMemo> {
    const broker = await this.broker();
    const { endpoint, model } = await this.metadata();

    const userContent = buildUserContent(metrics);
    const headers = await broker.inference.getRequestHeaders(this.config.providerAddress, userContent);

    const url = `${endpoint.replace(/\/$/, "")}/chat/completions`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(headers as unknown as Record<string, string>) },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: userContent }],
        // Memo is small structured JSON; 320 leaves headroom for verbose reasoning.
        max_tokens: 320,
        temperature: 0.2,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`0G Compute provider returned ${res.status}: ${text}`);
    }

    const data = (await res.json()) as {
      id?: string;
      choices?: { message?: { content?: string } }[];
      usage?: unknown;
    };
    const chatID = res.headers.get("ZG-Res-Key") ?? data.id;
    const answer = data.choices?.[0]?.message?.content ?? "";
    if (!answer) throw new Error("0G Compute returned an empty completion");

    const memo = parseMemo(answer, metrics);
    const rawResponseHash = keccak256(toBytes(answer));

    let verificationResult = false;
    let teeSignature: Hex = ("0x" + "00".repeat(65)) as Hex;
    if (this.config.verify && chatID) {
      const valid = await broker.inference.processResponse(
        this.config.providerAddress,
        chatID,
        JSON.stringify(data.usage ?? {}),
      );
      verificationResult = valid === true;
      // The broker doesn't surface the raw signature; rawResponseHash + chatID +
      // verificationResult is the proof anchor that ends up on 0G Storage and
      // chain. Future: extract the signature from broker internals if exposed.
    }

    return {
      memo,
      provider: this.config.providerAddress,
      model: this.config.model,
      responseId: chatID ?? `zg-res-${Date.now()}`,
      rawResponseHash,
      teeSignature,
      verificationResult,
      verifiedAt: Math.floor(Date.now() / 1000),
    };
  }

  private broker() {
    if (!this.brokerPromise) {
      this.brokerPromise = createZGComputeNetworkBroker(
        this.wallet,
        undefined,
        undefined,
        undefined,
        this.config.gasPriceWei ?? 3_000_000_000,
      );
    }
    return this.brokerPromise;
  }

  private async metadata() {
    if (!this.metadataPromise) {
      this.metadataPromise = this.broker().then((b) =>
        b.inference.getServiceMetadata(this.config.providerAddress),
      );
    }
    return this.metadataPromise;
  }
}

function buildUserContent(metrics: PoolMetrics): string {
  const metricsJson = JSON.stringify(metrics, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  return `${PROMPT_TEMPLATE}\n\nMetrics:\n${metricsJson}\n\nRespond with the JSON object only.`;
}

function parseMemo(raw: string, metrics: PoolMetrics): RiskMemo {
  // The model occasionally wraps JSON in ``` fences or adds a leading line.
  // Extract the first {...} block defensively.
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`compute response did not contain a JSON object: ${raw.slice(0, 200)}`);
  }
  const slice = raw.slice(start, end + 1);

  let parsed: unknown;
  try {
    parsed = JSON.parse(slice);
  } catch (e) {
    throw new Error(`compute response was not valid JSON: ${e instanceof Error ? e.message : e}`);
  }
  if (!isObject(parsed)) throw new Error("compute response root was not an object");

  const riskScoreBps = clampInt(asNumber(parsed.riskScoreBps, "riskScoreBps"), 0, 10_000);
  const recommendedFee = clampInt(asNumber(parsed.recommendedFee, "recommendedFee"), 0, 100_000);
  const recommendedMaxAbsAmount = asBigInt(parsed.recommendedMaxAbsAmount, "recommendedMaxAbsAmount");
  const reasoning = asStringArray(parsed.reasoning, "reasoning");

  return {
    riskScoreBps,
    recommendedFee,
    recommendedMaxAbsAmount,
    reasoning: reasoning.length === 0 ? ["(no reasoning provided)"] : reasoning,
    observations: metrics,
  };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function asNumber(v: unknown, name: string): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  throw new Error(`${name} not a number: ${JSON.stringify(v)}`);
}
function asBigInt(v: unknown, name: string): bigint {
  if (typeof v === "string" && /^\d+$/.test(v)) return BigInt(v);
  if (typeof v === "number" && Number.isInteger(v) && v >= 0) return BigInt(v);
  throw new Error(`${name} not a non-negative integer: ${JSON.stringify(v)}`);
}
function asStringArray(v: unknown, name: string): string[] {
  if (!Array.isArray(v)) throw new Error(`${name} not an array`);
  return v.filter((x): x is string => typeof x === "string");
}
function clampInt(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(n)));
}
