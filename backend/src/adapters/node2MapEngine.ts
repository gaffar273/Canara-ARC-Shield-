import { config } from "../config/index.js";
import type { Clause, ComplianceMap } from "../types/domain.js";
import { postJson } from "./httpClient.js";
import { fail } from "../utils/errors.js";

export interface MapRequest {
  circularId: string;
  clauses: Clause[];
}

/**
 * Node 2 — MAP Engine (external microservice). Takes obligation-bearing clauses
 * and returns compliance MAPs. The backend does no reasoning itself; it calls
 * the service at NODE2_URL.
 */
export const node2 = {
  async generate(req: MapRequest): Promise<ComplianceMap[]> {
    if (!config.agents.node2Url) {
      throw fail("UPSTREAM_ERROR", "NODE2_URL is not configured");
    }
    return postJson<ComplianceMap[]>(`${config.agents.node2Url}/map`, req);
  },
};
