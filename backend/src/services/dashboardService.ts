import { config } from "../config/index.js";
import type { RegSection, Role } from "../types/domain.js";
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

  return {
    complianceScore,
    pendingMaps,
    activeCirculars,
    riskAlerts,
    sections,
    pipelineStages,
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
};
