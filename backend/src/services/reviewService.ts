import type { ComplianceMap, DecisionStatus, MapDecision, Role } from "../types/domain.js";
import { stateStore } from "../store/stateStore.js";
import { ledgerService } from "./ledgerService.js";
import { dashboardService } from "./dashboardService.js";
import { fail } from "../utils/errors.js";

export interface DecisionInput {
  status: DecisionStatus;
  note: string;
  decidedBy: Role;
  reassignedTo?: Role | null;
}

const ROLES: Role[] = ["compliance", "it", "cxo", "auditor"];

/**
 * Human-in-the-loop review. A compliance officer's decision on a flagged MAP is
 * first sealed on the audit chain (so the human action is itself tamper-evident),
 * then written to state carrying that block hash. Ordering matters: seal first so
 * a stored decision always references a real on-chain block.
 */
export const reviewService = {
  async decide(circularId: string, mapId: string, input: DecisionInput): Promise<ComplianceMap> {
    if (input.status === "REASSIGNED") {
      if (!input.reassignedTo || !ROLES.includes(input.reassignedTo)) {
        throw fail("BAD_REQUEST", "REASSIGNED requires a valid reassignedTo role");
      }
    }

    const pipeline = await stateStore.getPipeline(circularId);
    if (!pipeline) throw fail("NOT_FOUND", `Unknown circular ${circularId}`);
    const map = pipeline.maps.find((m) => m.id === mapId);
    if (!map) throw fail("NOT_FOUND", `Unknown MAP ${mapId} on ${circularId}`);
    if (map.decision) throw fail("CONFLICT", `MAP ${mapId} already has a decision`);

    const decidedAt = new Date().toISOString();
    const reassignedTo = input.status === "REASSIGNED" ? input.reassignedTo ?? null : null;

    // Seal the decision on-chain first; the payload commits to what was decided.
    const block = await ledgerService.recordHumanDecision(circularId, {
      circularId,
      mapId,
      status: input.status,
      note: input.note,
      decidedBy: input.decidedBy,
      decidedAt,
      reassignedTo,
    });

    const decision: MapDecision = {
      status: input.status,
      note: input.note,
      decidedBy: input.decidedBy,
      decidedAt,
      reassignedTo,
      ledgerHash: block.hash,
    };

    const updated = await stateStore.decideMap(circularId, mapId, decision);
    dashboardService.invalidate();
    return updated;
  },
};
