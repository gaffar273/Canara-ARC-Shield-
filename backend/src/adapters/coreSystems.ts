import { config } from "../config/index.js";
import { sendJson } from "./httpClient.js";
import { fail } from "../utils/errors.js";

export interface SystemsState {
  systems: Record<
    string,
    { system: string; parameters: Record<string, unknown> }
  >;
}

export interface ParameterValue {
  department: string;
  system: string;
  parameter: string;
  actualValue: unknown;
}

/**
 * Core Systems (external service at CORE_SYSTEMS_URL). The same operational
 * state Node 3 verifies against — the backend proxies it so the dashboard can
 * read live posture and an operator can change a value, driving re-validation.
 */
export const coreSystems = {
  enabled(): boolean {
    return Boolean(config.agents.coreSystemsUrl);
  },

  async all(): Promise<SystemsState> {
    if (!config.agents.coreSystemsUrl) {
      throw fail("UPSTREAM_ERROR", "CORE_SYSTEMS_URL is not configured");
    }
    const systems = await sendJson<SystemsState["systems"]>(
      "GET",
      `${config.agents.coreSystemsUrl}/systems`,
    );
    return { systems };
  },

  async update(department: string, parameter: string, value: unknown): Promise<ParameterValue> {
    if (!config.agents.coreSystemsUrl) {
      throw fail("UPSTREAM_ERROR", "CORE_SYSTEMS_URL is not configured");
    }
    const dept = encodeURIComponent(department);
    const param = encodeURIComponent(parameter);
    return sendJson<ParameterValue>(
      "PUT",
      `${config.agents.coreSystemsUrl}/systems/${dept}/${param}`,
      { value },
    );
  },
};
