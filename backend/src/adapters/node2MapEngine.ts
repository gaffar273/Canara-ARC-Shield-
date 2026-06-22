import { config } from "../config/index.js";
import type { Clause, ComplianceMap, Regulator } from "../types/domain.js";
import { postJson } from "./httpClient.js";
import { fail } from "../utils/errors.js";

export interface MapRequest {
  circularId: string;
  regulator: Regulator | null;
  circularDate: string | null;
  clauses: Clause[];
}

/**
 * Node 2 — MAP Engine (external microservice). Takes the circular's obligation
 * clauses and returns one compliance MAP per detected regulatory change. The
 * backend does no reasoning itself; it calls the service at NODE2_URL, which
 * wraps the Python engine and emits MAPs already shaped to our domain.
 */
export const node2 = {
  async generate(req: MapRequest): Promise<ComplianceMap[]> {
    if (!config.agents.node2Url) {
      throw fail("UPSTREAM_ERROR", "NODE2_URL is not configured");
    }
    return postJson<ComplianceMap[]>(`${config.agents.node2Url}/map`, req);
  },
};
