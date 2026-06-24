import { config } from "../config/index.js";
import type { Circular, ComplianceMap, MapDecision, PipelineRecord, PipelineStage } from "../types/domain.js";
import { Mutex } from "../utils/mutex.js";
import { fail } from "../utils/errors.js";
import { readJsonFile, writeJsonFileAtomic } from "./persistence.js";

interface StateShape {
  circulars: Record<string, Circular>;
  pipelines: Record<string, PipelineRecord>;
}

export interface ReferenceEdge {
  ref: string;
  circularId: string | null;
}

export interface ReferenceGraph {
  circularId: string;
  refNumber: string | null;
  references: ReferenceEdge[];
  citedBy: { circularId: string; refNumber: string | null }[];
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
  private refIndex = new Map<string, string>();
  private loaded = false;

  private async load(): Promise<void> {
    if (this.loaded) return;
    this.cache = await readJsonFile<StateShape>(config.paths.state, empty);
    this.refIndex.clear();
    for (const circular of Object.values(this.cache.circulars)) {
      this.indexCircular(circular);
    }
    this.loaded = true;
  }

  /** Derived index: normalized own-ref -> circular id. First writer wins. */
  private indexCircular(circular: Circular): void {
    if (circular.refNumber && !this.refIndex.has(circular.refNumber)) {
      this.refIndex.set(circular.refNumber, circular.id);
    }
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
      this.indexCircular(circular);
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
   * Removes a circular and its pipeline. The hash-linked audit ledger is
   * append-only by design and is intentionally left intact. Returns false if
   * the circular was already absent (idempotent delete).
   */
  async deleteCircular(id: string): Promise<boolean> {
    return this.lock.run(async () => {
      await this.load();
      const circular = this.cache.circulars[id];
      if (!circular) return false;
      delete this.cache.circulars[id];
      delete this.cache.pipelines[id];
      this.rebuildRefIndex();
      await this.persist();
      return true;
    });
  }

  /** Rebuilds the derived ref index from scratch after a removal. */
  private rebuildRefIndex(): void {
    this.refIndex.clear();
    for (const circular of Object.values(this.cache.circulars)) {
      this.indexCircular(circular);
    }
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
      this.indexCircular(circular);
      await this.persist();
      return record;
    });
  }

  /**
   * Records a human reviewer's decision on one MAP. Runs inside the mutex so it
   * cannot interleave with a pipeline transition writing the same record.
   */
  async decideMap(
    circularId: string,
    mapId: string,
    decision: MapDecision,
  ): Promise<ComplianceMap> {
    return this.lock.run(async () => {
      await this.load();
      const record = this.cache.pipelines[circularId];
      if (!record) throw fail("NOT_FOUND", `Unknown circular ${circularId}`);
      const map = record.maps.find((m) => m.id === mapId);
      if (!map) throw fail("NOT_FOUND", `Unknown MAP ${mapId} on ${circularId}`);
      map.decision = decision;
      map.needsReview = false;
      if (decision.status === "REASSIGNED" && decision.reassignedTo) {
        map.owner = decision.reassignedTo;
      }
      record.updatedAt = new Date().toISOString();
      await this.persist();
      return map;
    });
  }

  /** Resolved + dangling outgoing edges plus incoming back-edges for one circular. */
  async referenceGraph(circularId: string): Promise<ReferenceGraph> {
    await this.load();
    const circular = this.cache.circulars[circularId];
    if (!circular) throw fail("NOT_FOUND", `Unknown circular ${circularId}`);

    const references: ReferenceEdge[] = circular.references.map((ref) => ({
      ref,
      circularId: this.refIndex.get(ref) ?? null,
    }));

    const citedBy = Object.values(this.cache.circulars)
      .filter(
        (c) =>
          c.id !== circularId &&
          circular.refNumber !== null &&
          c.references.includes(circular.refNumber),
      )
      .map((c) => ({ circularId: c.id, refNumber: c.refNumber }));

    return { circularId, refNumber: circular.refNumber, references, citedBy };
  }

  /** Circulars this one explicitly cites, resolved through the ref index. */
  async getLinkedCirculars(circularId: string): Promise<Circular[]> {
    await this.load();
    const circular = this.cache.circulars[circularId];
    if (!circular) return [];
    return circular.references
      .map((ref) => this.refIndex.get(ref))
      .filter((id): id is string => id !== undefined)
      .map((id) => this.cache.circulars[id])
      .filter((c): c is Circular => c !== undefined);
  }
}

export const stateStore = new StateStore();
