import { config } from "../config/index.js";
import type { IntelligenceResult } from "../types/domain.js";
import { postJson } from "./httpClient.js";
import { fail } from "../utils/errors.js";

export interface IntelligenceRequest {
  circularId: string;
  filename: string;
  text: string;
}

/**
 * Node 1 — Regulatory Intelligence (external microservice). Classifies the
 * circular, extracts obligation clauses, and returns the enriched result. The
 * backend does no classification itself; it calls the service at NODE1_URL.
 */
export const node1 = {
  async analyze(req: IntelligenceRequest): Promise<IntelligenceResult> {
    if (!config.agents.node1Url) {
      throw fail("UPSTREAM_ERROR", "NODE1_URL is not configured");
    }
    return postJson<IntelligenceResult>(`${config.agents.node1Url}/analyze`, req);
  },
};
