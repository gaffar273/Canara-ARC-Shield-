import { config } from "../../config/index.js";
import type { LedgerBlock } from "../../types/domain.js";
import { Mutex } from "../../utils/mutex.js";
import { sha256 } from "../../utils/crypto.js";
import { appendLine, readLines } from "../persistence.js";
import type { LedgerBackend, VerifyResult } from "./types.js";

const GENESIS_PREV = "0x0";

function blockHash(b: Omit<LedgerBlock, "hash">): string {
  return sha256(
    `${b.index}|${b.timestamp}|${b.kind}|${b.refId}|${b.payloadHash}|${b.prevHash}`,
  );
}

/**
 * Local append-only, hash-linked ledger. Single writer (mutex) so concurrent
 * appends cannot fork the chain or race on the head pointer. Persisted as JSONL;
 * the head is cached in memory after first load. Used when Fabric is disabled.
 */
export class HashChainBackend implements LedgerBackend {
  readonly kind = "hash-chain" as const;
  private readonly lock = new Mutex();
  private head: LedgerBlock | null = null;
  private loaded = false;

  private async load(): Promise<void> {
    if (this.loaded) return;
    const lines = await readLines(config.paths.ledger);
    const last = lines.at(-1);
    this.head = last ? (JSON.parse(last) as LedgerBlock) : null;
    this.loaded = true;
  }

  async append(
    kind: LedgerBlock["kind"],
    refId: string,
    payloadHash: string,
  ): Promise<LedgerBlock> {
    return this.lock.run(async () => {
      await this.load();
      const prev = this.head;
      const base: Omit<LedgerBlock, "hash"> = {
        index: prev ? prev.index + 1 : 0,
        timestamp: new Date().toISOString(),
        kind,
        refId,
        payloadHash,
        prevHash: prev ? prev.hash : GENESIS_PREV,
      };
      const block: LedgerBlock = { ...base, hash: blockHash(base) };
      await appendLine(config.paths.ledger, JSON.stringify(block));
      this.head = block;
      return block;
    });
  }

  async all(): Promise<LedgerBlock[]> {
    const lines = await readLines(config.paths.ledger);
    return lines.map((l) => JSON.parse(l) as LedgerBlock);
  }

  async forRef(refId: string): Promise<LedgerBlock[]> {
    const blocks = await this.all();
    return blocks.filter((b) => b.refId === refId);
  }

  async verifyChain(): Promise<VerifyResult> {
    const blocks = await this.all();
    let prevHash = GENESIS_PREV;
    for (const b of blocks) {
      const { hash, ...rest } = b;
      if (b.prevHash !== prevHash || blockHash(rest) !== hash) {
        return { valid: false, brokenAt: b.index };
      }
      prevHash = hash;
    }
    return { valid: true, brokenAt: null };
  }
}
