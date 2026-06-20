import { config } from "../config/index.js";
import type { VerificationStatus } from "../types/domain.js";
import { stateStore } from "../store/stateStore.js";
import { postJson } from "../adapters/httpClient.js";
import { fail } from "../utils/errors.js";

export interface Citation {
  circularId: string;
  clauseId: string;
  title: string;
  verification: VerificationStatus | "UNVERIFIED";
}

export interface CopilotAnswer {
  answer: string;
  citations: Citation[];
  knowledgeBase: { circulars: number; clauses: number };
}

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [];
}

/**
 * Retrieval is the backend's job: search the stored clauses, rank by overlap,
 * and attach each clause's current verification status. The natural-language
 * answer is produced by the external RAG/LLM copilot service.
 */
async function retrieve(query: string, limit: number): Promise<Citation[]> {
  const terms = new Set(tokenize(query));
  if (terms.size === 0) return [];
  const pipelines = await stateStore.listPipelines();

  const verByMapClause = new Map<string, VerificationStatus>();
  for (const p of pipelines) {
    const mapById = new Map(p.maps.map((m) => [m.id, m]));
    for (const v of p.verifications) {
      const map = mapById.get(v.mapId);
      if (map) verByMapClause.set(`${p.circularId}:${map.clauseId}`, v.status);
    }
  }

  const scored: { citation: Citation; score: number }[] = [];
  for (const p of pipelines) {
    for (const clause of p.intelligence?.clauses ?? []) {
      const haystack = tokenize(`${clause.title} ${clause.text}`);
      const score = haystack.filter((w) => terms.has(w)).length;
      if (score === 0) continue;
      scored.push({
        score,
        citation: {
          circularId: p.circularId,
          clauseId: clause.id,
          title: clause.title,
          verification:
            verByMapClause.get(`${p.circularId}:${clause.id}`) ?? "UNVERIFIED",
        },
      });
    }
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.citation);
}

export const copilotService = {
  async ask(query: string): Promise<CopilotAnswer> {
    const citations = await retrieve(query, 5);
    const circulars = await stateStore.listCirculars();
    const clauseCount = (await stateStore.listPipelines()).reduce(
      (n, p) => n + (p.intelligence?.clauses.length ?? 0),
      0,
    );
    const kb = { circulars: circulars.length, clauses: clauseCount };

    if (!config.agents.copilotUrl) {
      throw fail("UPSTREAM_ERROR", "COPILOT_URL is not configured");
    }
    const remote = await postJson<{ answer: string }>(
      `${config.agents.copilotUrl}/copilot`,
      { query, citations },
    );
    return { answer: remote.answer, citations, knowledgeBase: kb };
  },
};
