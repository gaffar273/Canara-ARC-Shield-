import { config } from "../config/index.js";
import { fail } from "../utils/errors.js";

/**
 * One JSON POST path for every agent adapter. Times out via AbortController so a
 * hung agent service can never block the pipeline indefinitely.
 */
export async function postJson<T>(url: string, body: unknown): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.agents.timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw fail("UPSTREAM_ERROR", `Agent ${url} responded ${res.status}`);
    }
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw fail("UPSTREAM_ERROR", `Agent ${url} timed out`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
