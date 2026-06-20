import type { PipelineRecord } from "../types/domain.js";
import { stateStore } from "../store/stateStore.js";
import { fail } from "../utils/errors.js";
import { createQueue } from "../queue/index.js";
import { node1 } from "../adapters/node1Intelligence.js";
import { node2 } from "../adapters/node2MapEngine.js";
import { node3 } from "../adapters/node3Verification.js";
import { intakeService } from "./intakeService.js";
import { ledgerService } from "./ledgerService.js";
import { dashboardService } from "./dashboardService.js";

interface PipelineJob {
  circularId: string;
}

const queue = createQueue<PipelineJob>("pipeline");

async function runStages(circularId: string): Promise<void> {
  const circular = await stateStore.getCircular(circularId);
  if (!circular) throw fail("NOT_FOUND", `Unknown circular ${circularId}`);

  const text = await intakeService.extractText(circularId);
  const intelligence = await node1.analyze({
    circularId,
    filename: circular.document.filename,
    text,
  });
  await stateStore.transition(circularId, "CLASSIFYING", (r, c) => {
    r.intelligence = intelligence;
    c.title = intelligence.title;
    c.regulator = intelligence.regulator;
    c.sections = intelligence.sections;
    c.issuedDate = intelligence.issuedDate;
  });

  const maps = await node2.generate({ circularId, clauses: intelligence.clauses });
  await ledgerService.recordMapGenerated(circularId, maps);
  await stateStore.transition(circularId, "MAPPING", (r) => {
    r.maps = maps;
  });

  const verifications = await node3.verify({ circularId, maps });
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
}

queue.process(async ({ circularId }) => {
  try {
    await runStages(circularId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
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
