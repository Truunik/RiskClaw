import type { Hex } from "../types/risk.ts";

/// Wrapper around 0G Storage. Two surfaces:
///   - kv: live state (latest pool snapshot, last decision)
///   - log: append-only stream of agent observations & decisions
/// Returns root hashes that get committed onchain inside PolicyProof.
///
/// Using a small interface here so we can swap in @0glabs/0g-ts-sdk without
/// touching the agent code. Day-1 implementation = in-memory; day-2 = real SDK.
export interface ZeroGMemory {
  kvSet(key: string, value: unknown): Promise<Hex>;
  kvGet<T>(key: string): Promise<T | undefined>;
  logAppend(stream: string, entry: unknown): Promise<Hex>;
  upload(bytes: Uint8Array): Promise<Hex>;
}

export class InMemoryZeroGMemory implements ZeroGMemory {
  private kv = new Map<string, unknown>();
  private logs = new Map<string, unknown[]>();

  async kvSet(key: string, value: unknown): Promise<Hex> {
    this.kv.set(key, value);
    return hashish(stringify(value));
  }
  async kvGet<T>(key: string): Promise<T | undefined> {
    return this.kv.get(key) as T | undefined;
  }
  async logAppend(stream: string, entry: unknown): Promise<Hex> {
    const list = this.logs.get(stream) ?? [];
    list.push(entry);
    this.logs.set(stream, list);
    return hashish(stringify(entry));
  }
  async upload(bytes: Uint8Array): Promise<Hex> {
    return hashish(new TextDecoder().decode(bytes));
  }
}

function stringify(v: unknown): string {
  return JSON.stringify(v, (_k, val) => (typeof val === "bigint" ? val.toString() : val));
}

function hashish(input: string): Hex {
  let h = 0n;
  for (const c of input) h = (h * 1315423911n + BigInt(c.charCodeAt(0))) & ((1n << 256n) - 1n);
  return ("0x" + h.toString(16).padStart(64, "0")) as Hex;
}
