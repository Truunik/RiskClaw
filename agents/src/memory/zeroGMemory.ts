import { Indexer, MemData } from "@0gfoundation/0g-ts-sdk";
import { JsonRpcProvider, Wallet } from "ethers";
import type { Hex } from "../types/risk.ts";

/// Persistent storage for the agent swarm. Each call returns a content-addressed
/// root that can be fetched back via download(). The root hashes are what end up
/// onchain inside PolicyProof — explanationRoot for the memo, computeProofRoot
/// for the TEE artifact, metricsRoot for the Observer's snapshot.
export interface ZeroGMemory {
  kvSet(key: string, value: unknown): Promise<Hex>;
  kvGet<T>(key: string): Promise<T | undefined>;
  logAppend(stream: string, entry: unknown): Promise<Hex>;
  upload(bytes: Uint8Array): Promise<Hex>;
  download(rootHash: Hex): Promise<Uint8Array>;
}

export class InMemoryZeroGMemory implements ZeroGMemory {
  private kv = new Map<string, unknown>();
  private logs = new Map<string, unknown[]>();
  private blobs = new Map<Hex, Uint8Array>();

  async kvSet(key: string, value: unknown): Promise<Hex> {
    this.kv.set(key, value);
    return this.upload(serialize(value));
  }
  async kvGet<T>(key: string): Promise<T | undefined> {
    return this.kv.get(key) as T | undefined;
  }
  async logAppend(stream: string, entry: unknown): Promise<Hex> {
    const list = this.logs.get(stream) ?? [];
    list.push(entry);
    this.logs.set(stream, list);
    return this.upload(serialize(entry));
  }
  async upload(bytes: Uint8Array): Promise<Hex> {
    const root = hashish(new TextDecoder().decode(bytes));
    this.blobs.set(root, bytes);
    return root;
  }
  async download(rootHash: Hex): Promise<Uint8Array> {
    const b = this.blobs.get(rootHash);
    if (!b) throw new Error(`InMemoryZeroGMemory: unknown root ${rootHash}`);
    return b;
  }
}

/// Real 0G Storage adapter. Uploads small JSON blobs via the Indexer; the SDK
/// handles sharding + posting the storage tx onchain. Each upload costs a small
/// amount of gas — keep payloads minimal.
export class ZeroGStorageMemory implements ZeroGMemory {
  private indexer: Indexer;
  private signer: Wallet;

  constructor(
    indexerUrl: string,
    rpcUrl: string,
    privateKey: string,
  ) {
    this.indexer = new Indexer(indexerUrl);
    const provider = new JsonRpcProvider(rpcUrl);
    this.signer = new Wallet(privateKey, provider);
  }

  async kvSet(key: string, value: unknown): Promise<Hex> {
    return this.upload(serialize({ kind: "kv", key, value, ts: Date.now() }));
  }

  // Read-by-key isn't supported — 0G Storage is content-addressed. Callers track
  // the root they got from kvSet and use download(root) to fetch.
  async kvGet<T>(_key: string): Promise<T | undefined> {
    return undefined;
  }

  async logAppend(stream: string, entry: unknown): Promise<Hex> {
    return this.upload(serialize({ kind: "log", stream, entry, ts: Date.now() }));
  }

  async upload(bytes: Uint8Array): Promise<Hex> {
    const file = new MemData(Array.from(bytes));
    const [tx, err] = await this.indexer.upload(file, this.rpcUrl(), this.signer);
    if (err) throw new Error(`0G Storage upload failed: ${err.message ?? err}`);
    const rootHash = "rootHash" in tx ? tx.rootHash : tx.rootHashes[0];
    if (!rootHash) throw new Error("0G Storage upload returned no rootHash");
    return normalize(rootHash);
  }

  async download(rootHash: Hex): Promise<Uint8Array> {
    const [blob, err] = await this.indexer.downloadToBlob(rootHash);
    if (err) throw new Error(`0G Storage download failed: ${err.message ?? err}`);
    const buf = await blob.arrayBuffer();
    return new Uint8Array(buf);
  }

  private rpcUrl(): string {
    const provider = this.signer.provider as JsonRpcProvider;
    return provider._getConnection().url;
  }
}

function serialize(v: unknown): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify(v, (_k, val) => (typeof val === "bigint" ? val.toString() : val)),
  );
}

function normalize(s: string): Hex {
  return (s.startsWith("0x") ? s : "0x" + s) as Hex;
}

function hashish(input: string): Hex {
  let h = 0n;
  for (const c of input) h = (h * 1315423911n + BigInt(c.charCodeAt(0))) & ((1n << 256n) - 1n);
  return ("0x" + h.toString(16).padStart(64, "0")) as Hex;
}
