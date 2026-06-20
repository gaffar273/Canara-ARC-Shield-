import { config } from "../config/index.js";
import type { ComplianceMap, VerificationResult } from "../types/domain.js";
import { postJson } from "./httpClient.js";
import { fail } from "../utils/errors.js";

export interface VerifyRequest {
  circularId: string;
  maps: ComplianceMap[];
}

/**
 * Node 3 — Verification Engine (external microservice). Verifies each MAP and
 * returns PASS/FAIL/REVIEW with an evidence package. The backend does no
 * verification itself; it calls the service at NODE3_URL.
 */
export const node3 = {
  async verify(req: VerifyRequest): Promise<VerificationResult[]> {
    if (!config.agents.node3Url) {
      throw fail("UPSTREAM_ERROR", "NODE3_URL is not configured");
    }
    return postJson<VerificationResult[]>(`${config.agents.node3Url}/verify`, req);
  },
};
