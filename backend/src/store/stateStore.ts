import { config } from "../config/index.js";
import type { Circular, PipelineRecord, PipelineStage } from "../types/domain.js";
import { Mutex } from "../utils/mutex.js";
import { fail } from "../utils/errors.js";
import { readJsonFile, writeJsonFileAtomic } from "./persistence.js";

interface StateShape {
  circulars: Record<string, Circular>;
  pipelines: Record<string, PipelineRecord>;
}

const empty: StateShape = { circulars: {}, pipelines: {} };

const VALID_TRANSITIONS: Record<PipelineStage, PipelineStage[]> = {
  RECEIVED: ["CLASSIFYING", "FAILED"],
  CLASSIFYING: ["MAPPING", "FAILED"],
  MAPPING: ["VERIFYING", "FAILED"],
  VERIFYING: ["SEALED", "FAILED"],
  SEALED: ["COMPLETE", "FAILED"],
  COMPLETE: [],
  FAILED: [],
};

/**
 * Single guarded owner of circular + pipeline state. Every mutation runs inside
 * the mutex, so concurrent callers cannot interleave a read-modify-write.
 */
class StateStore {
  private readonly lock = new Mutex();
  private cache: StateShape = empty;
  private loaded = false;

  private async load(): Promise<void> {
    if (this.loaded) return;
    this.cache = await readJsonFile<StateShape>(config.paths.state, empty);
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    await writeJsonFileAtomic(config.paths.state, this.cache);
  }

  async listCirculars(): Promise<Circular[]> {
    await this.load();
    return Object.values(this.cache.circulars);
  }

  async getCircular(id: string): Promise<Circular | null> {
    await this.load();
    return this.cache.circulars[id] ?? null;
  }

  async getPipeline(id: string): Promise<PipelineRecord | null> {
    await this.load();
    return this.cache.pipelines[id] ?? null;
  }

  async listPipelines(): Promise<PipelineRecord[]> {
    await this.load();
    return Object.values(this.cache.pipelines);
  }

  async createCircular(circular: Circular): Promise<Circular> {
    return this.lock.run(async () => {
      await this.load();
      this.cache.circulars[circular.id] = circular;
      this.cache.pipelines[circular.id] = {
        circularId: circular.id,
        stage: circular.stage,
        intelligence: null,
        maps: [],
        verifications: [],
        auditReceiptHash: null,
        updatedAt: circular.receivedAt,
        error: null,
      };
      await this.persist();
      return circular;
    });
  }

  /**
   * Atomic, idempotent stage transition. Re-applying the same stage is a no-op
   * (idempotent retries); an illegal jump throws CONFLICT.
   */
  async transition(
    circularId: string,
    to: PipelineStage,
    patch: (record: PipelineRecord, circular: Circular) => void,
  ): Promise<PipelineRecord> {
    return this.lock.run(async () => {
      await this.load();
      const record = this.cache.pipelines[circularId];
      const circular = this.cache.circulars[circularId];
      if (!record || !circular) {
        throw fail("NOT_FOUND", `Unknown circular ${circularId}`);
      }
      if (record.stage !== to) {
        const allowed = VALID_TRANSITIONS[record.stage];
        if (!allowed.includes(to)) {
          throw fail(
            "CONFLICT",
            `Illegal transition ${record.stage} -> ${to} for ${circularId}`,
          );
        }
      }
      patch(record, circular);
      record.stage = to;
      record.updatedAt = new Date().toISOString();
      circular.stage = to;
      await this.persist();
      return record;
    });
  }
}

export const stateStore = new StateStore();
