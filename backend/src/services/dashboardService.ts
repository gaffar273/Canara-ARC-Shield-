import { config } from "../config/index.js";
import type { RegSection, Role, VerificationStatus } from "../types/domain.js";
import { stateStore } from "../store/stateStore.js";
import { TtlCache } from "../utils/cache.js";

export interface SectionScore {
  section: RegSection;
  score: number;
  status: "compliant" | "warning" | "violation";
}

export interface DashboardSummary {
  complianceScore: number;
  pendingMaps: number;
  activeCirculars: number;
  riskAlerts: number;
  sections: SectionScore[];
  pipelineStages: Record<string, number>;
  departmentDistribution: Record<string, number>;
  severityDistribution: Record<string, number>;
}

function statusFor(score: number): SectionScore["status"] {
  if (score >= 95) return "compliant";
  if (score >= 90) return "warning";
  return "violation";
}

const cache = new TtlCache<DashboardSummary>(config.cache.dashboardTtlMs);
const CACHE_KEY = "summary";

async function compute(): Promise<DashboardSummary> {
  const circulars = await stateStore.listCirculars();
  const pipelines = await stateStore.listPipelines();

  const allMaps = pipelines.flatMap((p) => p.maps);
  const allVers = pipelines.flatMap((p) => p.verifications);

  const pendingMaps = allMaps.filter((m) => m.needsReview).length;
  const activeCirculars = circulars.filter((c) => c.stage !== "COMPLETE").length;
  const riskAlerts = allVers.filter((v) => v.status === "FAIL").length;

  const passRate =
    allVers.length === 0
      ? 0
      : allVers.filter((v) => v.status === "PASS").length / allVers.length;
  const complianceScore = Number((passRate * 100).toFixed(1));

  const bySection = new Map<RegSection, { sum: number; n: number }>();
  for (const p of pipelines) {
    const sections = p.intelligence?.sections ?? [];
    const verScore =
      p.verifications.length === 0
        ? 0
        : p.verifications.reduce((a, v) => a + v.score, 0) / p.verifications.length;
    for (const section of sections) {
      const cur = bySection.get(section) ?? { sum: 0, n: 0 };
      cur.sum += verScore * 100;
      cur.n += 1;
      bySection.set(section, cur);
    }
  }
  const sections: SectionScore[] = [...bySection.entries()].map(([section, agg]) => {
    const score = Number((agg.sum / agg.n).toFixed(1));
    return { section, score, status: statusFor(score) };
  });

  const pipelineStages: Record<string, number> = {};
  for (const p of pipelines) {
    pipelineStages[p.stage] = (pipelineStages[p.stage] ?? 0) + 1;
  }

  const departmentDistribution: Record<string, number> = {};
  const severityDistribution: Record<string, number> = {};
  for (const m of allMaps) {
    const dept = m.department || "Unmapped";
    departmentDistribution[dept] = (departmentDistribution[dept] ?? 0) + 1;
    const imp = m.impact || "MEDIUM";
    severityDistribution[imp] = (severityDistribution[imp] ?? 0) + 1;
  }

  return {
    complianceScore,
    pendingMaps,
    activeCirculars,
    riskAlerts,
    sections,
    pipelineStages,
    departmentDistribution,
    severityDistribution,
  };
}

export const dashboardService = {
  async summary(): Promise<DashboardSummary> {
    return cache.wrap(CACHE_KEY, compute);
  },

  invalidate(): void {
    cache.invalidate(CACHE_KEY);
  },

  /** MAPs and verifications relevant to a role's workspace view. */
  async roleWorkspace(role: Role) {
    const pipelines = await stateStore.listPipelines();
    const maps = pipelines.flatMap((p) => p.maps).filter((m) => m.owner === role);
    const mapIds = new Set(maps.map((m) => m.id));
    const verifications = pipelines
      .flatMap((p) => p.verifications)
      .filter((v) => mapIds.has(v.mapId));
    return { role, maps, verifications };
  },

  /** Low-confidence MAPs flagged for human review, enriched with circular context.
   *  Includes MAPs where either Node 2 set needsReview (confidence < threshold)
   *  OR Node 3 returned a REVIEW verdict (no automated check available). */
  async reviewQueue() {
    const circulars = await stateStore.listCirculars();
    const titleById = new Map(circulars.map((c) => [c.id, c.title]));
    const pipelines = await stateStore.listPipelines();

    // Build a set of mapIds that Node 3 flagged as REVIEW
    const node3ReviewIds = new Set(
      pipelines
        .flatMap((p) => p.verifications)
        .filter((v) => v.status === "REVIEW")
        .map((v) => v.mapId),
    );

    const items = pipelines
      .flatMap((p) => p.maps)
      .filter((m) => m.needsReview || (node3ReviewIds.has(m.id) && !m.decision))
      .map((m) => ({
        ...m,
        circularTitle: titleById.get(m.circularId) ?? m.circularId,
      }))
      .sort((a, b) => a.confidence - b.confidence);
    return { count: items.length, items };
  },

  /**
   * Per-circular compliance rollup. Separates the pipeline lifecycle (is analysis
   * done) from the compliance reality (is the work actually done): an analysed
   * circular is rarely "all green" — most obligations are PENDING until a
   * department acts, FLAGGED where Node 3 found a live gap, MAPPED only where the
   * bank already satisfies it. Derived from real MAPs + Node 3 verdicts.
   */
  async circularStatuses(): Promise<Record<string, CircularStatus>> {
    const pipelines = await stateStore.listPipelines();
    const out: Record<string, CircularStatus> = {};
    for (const p of pipelines) {
      out[p.circularId] = rollup(p);
    }
    return out;
  },
};

export interface CircularStatus {
  status: "in_pipeline" | "failed" | "action_needed" | "in_progress" | "compliant";
  total: number;
  mapped: number;
  pending: number;
  flagged: number;
}

function rollup(p: {
  stage: string;
  maps: { id: string; decision?: { status: string } | null }[];
  verifications: { mapId: string; status: VerificationStatus }[];
}): CircularStatus {
  if (p.stage === "FAILED") return { status: "failed", total: 0, mapped: 0, pending: 0, flagged: 0 };

  const verdictByMap = new Map(p.verifications.map((v) => [v.mapId, v.status]));
  let mapped = 0;
  let pending = 0;
  let flagged = 0;
  for (const m of p.maps) {
    // Human decision takes priority over automated verification
    if (m.decision) {
      if (m.decision.status === "APPROVED") { mapped += 1; continue; }
      if (m.decision.status === "REJECTED") { flagged += 1; continue; }
    }
    const v = verdictByMap.get(m.id);
    if (v === "PASS") mapped += 1;
    else if (v === "FAIL") flagged += 1;
    else pending += 1; // REVIEW or not-yet-verified
  }
  const total = p.maps.length;

  // Still analysing: it's in the pipeline.
  if (p.stage !== "COMPLETE" && p.stage !== "SEALED") {
    return { status: "in_pipeline", total, mapped, pending, flagged };
  }
  // Analysis finished but produced no obligations to act on — nothing was
  // mapped, so this is NOT compliance, it needs a human look.
  if (total === 0) {
    return { status: "in_progress", total, mapped, pending, flagged };
  }
  // Compliant ONLY when every obligation is mapped AND verified satisfied.
  const status =
    flagged > 0
      ? "action_needed"
      : pending > 0 || mapped < total
        ? "in_progress"
        : "compliant";
  return { status, total, mapped, pending, flagged };
}
