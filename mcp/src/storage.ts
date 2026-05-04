import { Indexer } from "@0gfoundation/0g-ts-sdk";
import type { Hex } from "viem";

/// Read-only 0G Storage adapter. The full agent uses a signer-backed adapter
/// for uploads — the MCP only needs downloads, which the indexer serves
/// without authentication.
export class StorageReader {
  private indexer: Indexer;

  constructor(indexerUrl: string) {
    this.indexer = new Indexer(indexerUrl);
  }

  async download(rootHash: Hex): Promise<Uint8Array> {
    const [blob, err] = await this.indexer.downloadToBlob(rootHash);
    if (err) {
      throw new Error(`0G Storage download failed for ${rootHash}: ${err.message ?? err}`);
    }
    const buf = await blob.arrayBuffer();
    return new Uint8Array(buf);
  }

  async downloadJson<T = unknown>(rootHash: Hex): Promise<T> {
    const bytes = await this.download(rootHash);
    const text = new TextDecoder().decode(bytes);
    try {
      return JSON.parse(text) as T;
    } catch (e) {
      throw new Error(
        `Content at root ${rootHash} is not valid JSON. First 200 bytes: ${text.slice(0, 200)}`,
      );
    }
  }
}
