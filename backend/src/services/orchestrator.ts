import type { PipelineRecord } from "../types/domain.js";
import { stateStore } from "../store/stateStore.js";
import { fail } from "../utils/errors.js";
import { createQueue } from "../queue/index.js";
import { node1 } from "../adapters/node1Intelligence.js";
import { node2 } from "../adapters/node2MapEngine.js";
import type { BaselineClause } from "../adapters/node2MapEngine.js";
import { node3 } from "../adapters/node3Verification.js";
import { intakeService } from "./intakeService.js";
import { ledgerService } from "./ledgerService.js";
import { dashboardService } from "./dashboardService.js";
import { looksLikeTitle } from "../utils/title.js";

interface PipelineJob {
  circularId: string;
}

const queue = createQueue<PipelineJob>("pipeline");

const log = (circularId: string, msg: string): void =>
  console.log(`[pipeline] ${circularId} ${msg}`);

/**
 * Builds Node 2's diff baseline from the obligation clauses of the circulars
 * this one explicitly cites. Those clauses were extracted by Node 1 and live in
 * each cited circular's pipeline record; a circular that hasn't been processed
 * yet simply contributes nothing. An explicit citation is the authoritative
 * prior version, so this takes precedence over Node 2's semantic history store.
 */
async function buildBaseline(citedIds: string[]): Promise<BaselineClause[]> {
  const records = await Promise.all(citedIds.map((id) => stateStore.getPipeline(id)));
  return records.flatMap((record) =>
    (record?.intelligence?.clauses ?? []).map((clause) => ({
      section: clause.section,
      title: clause.title,
      text: clause.text,
      sourceCircularId: record!.circularId,
    })),
  );
}

async function runStages(circularId: string): Promise<void> {
  const startedAt = Date.now();
  const circular = await stateStore.getCircular(circularId);
  if (!circular) throw fail("NOT_FOUND", `Unknown circular ${circularId}`);
  log(circularId, `START "${circular.document.filename}"`);

  const text = await intakeService.extractText(circularId);
  const linked = await stateStore.getLinkedCirculars(circularId);
  const linkedCirculars = await Promise.all(
    linked.map(async (c) => ({
      circularId: c.id,
      refNumber: c.refNumber,
      title: c.title,
      text: await intakeService.extractText(c.id),
    })),
  );

  const allCirculars = await stateStore.listCirculars();
  const corpus = await Promise.all(
    allCirculars
      .filter((c) => c.id !== circularId)
      .slice(-25)
      .map(async (c) => ({
        circularId: c.id,
        refNumber: c.refNumber,
        title: c.title,
        text: await intakeService.extractText(c.id).catch(() => ""),
      })),
  );

  log(circularId, "CLASSIFYING -> Node 1 (intelligence)...");
  const intelligence = await node1.analyze({
    circularId,
    filename: circular.document.filename,
    text,
    ...(linkedCirculars.length > 0 || corpus.length > 0
      ? { context: { linkedCirculars, ...(corpus.length > 0 ? { corpus } : {}) } }
      : {}),
  });
  log(
    circularId,
    `CLASSIFYING done: "${intelligence.title}" [${intelligence.regulator}] ${intelligence.clauses.length} clauses`,
  );
  await stateStore.transition(circularId, "CLASSIFYING", (r, c) => {
    r.intelligence = intelligence;
    if (looksLikeTitle(intelligence.title)) c.title = intelligence.title;
    c.regulator = intelligence.regulator;
    c.sections = intelligence.sections;
    c.issuedDate = intelligence.issuedDate;
    if (!c.refNumber && intelligence.refNumber) c.refNumber = intelligence.refNumber;
    if (intelligence.references?.length) {
      c.references = [...new Set([...c.references, ...intelligence.references])];
    }
  });

  log(circularId, "MAPPING -> Node 2 (MAP engine)...");
  const baseline = await buildBaseline(linked.map((c) => c.id));
  if (baseline.length > 0) {
    log(
      circularId,
      `MAPPING baseline: ${baseline.length} clause(s) from ${linked.length} cited circular(s)`,
    );
  }
  const maps = await node2.generate({
    circularId,
    regulator: intelligence.regulator,
    circularDate: intelligence.issuedDate,
    clauses: intelligence.clauses,
    baseline,
  });
  log(circularId, `MAPPING done: ${maps.length} MAP(s)`);
  await ledgerService.recordMapGenerated(circularId, maps);
  await stateStore.transition(circularId, "MAPPING", (r) => {
    r.maps = maps.map((m) => ({ ...m, decision: m.decision ?? null }));
  });

  log(circularId, "VERIFYING -> Node 3 (verification)...");
  const verifications = await node3.verify({ circularId, maps });
  log(circularId, `VERIFYING done: ${verifications.length} verdict(s)`);
  await ledgerService.recordVerification(circularId, verifications);
  await ledgerService.recordEvidence(
    circularId,
    verifications.flatMap((v) => v.evidence),
  );
  await stateStore.transition(circularId, "VERIFYING", (r) => {
    r.verifications = verifications;
  });

  const sealed = await stateStore.transition(circularId, "SEALED", () => {});
  const receipt = await ledgerService.sealAuditReceipt(sealed);
  await stateStore.transition(circularId, "COMPLETE", (r) => {
    r.auditReceiptHash = receipt.hash;
  });
  dashboardService.invalidate();
  log(
    circularId,
    `COMPLETE sealed=${receipt.hash.slice(0, 12)}... in ${Date.now() - startedAt}ms`,
  );
}

queue.process(async ({ circularId }) => {
  try {
    await runStages(circularId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(circularId, `FAILED: ${message}`);
    await stateStore
      .transition(circularId, "FAILED", (r) => {
        r.error = message;
      })
      .catch(() => undefined);
    throw err;
  }
});

export const orchestrator = {
  /** Kicks off async processing. Returns immediately; status is read from state. */
  async start(circularId: string): Promise<void> {
    await queue.enqueue(circularId, { circularId });
  },

  async status(circularId: string): Promise<PipelineRecord> {
    const record = await stateStore.getPipeline(circularId);
    if (!record) throw fail("NOT_FOUND", `Unknown circular ${circularId}`);
    return record;
  },
};
