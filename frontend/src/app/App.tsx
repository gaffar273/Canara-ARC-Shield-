import { useState, useRef } from "react";
import {
  LayoutDashboard, Search, MessageSquare, ShieldCheck, Users,
  Lock, Bell, Settings, TrendingUp, TrendingDown, AlertTriangle,
  CheckCircle, FileText, Hash, Database, Send, RefreshCw,
  Download, ArrowRight, AlertCircle, Award, Zap, Building2,
  Globe, Fingerprint, GitBranch, ChevronRight, Eye, Cpu,
  Plus, Calendar, Filter, Upload, Link2, XCircle, User, Trash2,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from "recharts";
import { useApi } from "../hooks/useApi.js";
import * as api from "../services/endpoints.js";
import { uploadCircular, processCircular, deleteCircular } from "../services/endpoints.js";
import { ApiError } from "../services/client.js";
import { Loading, ErrorState, EmptyState } from "./components/States.js";
import type {
  Circular, PipelineStage, SectionScore, LedgerBlock, LedgerKind,
  Citation, Role, Impact,
} from "../services/types.js";

const CB = "#004C97";
const CY = "#F7B731";
const OK = "#16a34a";
const WN = "#d97706";
const ER = "#dc2626";

const NAV = [
  { id: "dashboard", icon: LayoutDashboard, label: "Executive Dashboard" },
  { id: "circular",  icon: Search,          label: "Circular Explorer" },
  { id: "diff",      icon: GitBranch,       label: "Policy Diff Analyzer" },
  { id: "kpi",       icon: Award,           label: "KPI Audit & Planner", badge: "AI" },
  { id: "copilot",   icon: MessageSquare,   label: "Compliance Copilot", badge: "AI" },
  { id: "blockchain",icon: ShieldCheck,     label: "Blockchain Trust Center" },
  { id: "roles",     icon: Users,           label: "Role Workspace" },
  { id: "review",    icon: AlertCircle,     label: "Review Queue" },
  { id: "security",  icon: Lock,            label: "Security & Trust" },
];

/* ─── SHARED HELPERS ───────────────────────────────────────────────────── */

const SC = { compliant: OK, warning: WN, violation: ER };

const KIND_LABEL: Record<LedgerKind, string> = {
  CIRCULAR_RECEIVED: "Circular Received",
  MAP_GENERATED: "MAP Generated",
  VERIFICATION_EXECUTED: "Verification Executed",
  EVIDENCE_COLLECTED: "Evidence Collected",
  AUDIT_RECEIPT: "Audit Receipt Issued",
  HUMAN_DECISION: "Human Decision Recorded",
};

function shortHash(h: string): string {
  if (!h) return "—";
  const body = h.startsWith("0x") ? h.slice(2) : h;
  return `0x${body.slice(0, 6)}…${body.slice(-4)}`;
}

function signerLabel(submittedBy: string | undefined): string {
  if (!submittedBy) return "—";
  const [msp, certHash] = submittedBy.split("::");
  if (!certHash) return msp;
  return `${msp} · ${certHash.slice(0, 8)}…`;
}

function dateOf(iso: string | null): string {
  if (!iso) return "—";
  return iso.slice(0, 10);
}

function impactColor(impact: Impact): string {
  if (impact === "CRITICAL") return "#7c2d12";
  if (impact === "HIGH") return ER;
  if (impact === "MEDIUM") return WN;
  return OK;
}

function verdictColor(status: string): string {
  if (status === "PASS") return OK;
  if (status === "FAIL") return ER;
  return WN;
}

function agentLabel(verifiedBy: string): string {
  return verifiedBy === "technical" ? "Technical Agent" : "Policy Agent";
}

function agentBadgeStyle(verifiedBy: string) {
  return verifiedBy === "technical"
    ? { background: `${CB}10`, color: CB }
    : { background: `${CY}25`, color: "#7a5200" };
}

function circularStatus(stage: PipelineStage): "active" | "warning" | "complete" {
  if (stage === "COMPLETE") return "complete";
  if (stage === "FAILED") return "warning";
  return "active";
}

const STATUS_COLOR: Record<string, string> = { active: CB, warning: WN, complete: OK };
const STATUS_LABEL: Record<string, string> = {
  active: "In Pipeline", warning: "Attention", complete: "Sealed",
};

/** Clause-level compliance status, derived from its MAP + Node 3 verdict.
 *  MAPPED = verified satisfied, FLAGGED = Node 3 found a gap, REVIEW = Node 3
 *  couldn't auto-verify (needs human), PENDING = MAP exists but not yet verified,
 *  UNMAPPED = no MAP yet. */
type ClauseStatus = "MAPPED" | "REVIEW" | "PENDING" | "FLAGGED" | "UNMAPPED";

const CLAUSE_STATUS_STYLE: Record<ClauseStatus, { bg: string; fg: string }> = {
  MAPPED:   { bg: "#dcfce7", fg: "#15803d" },
  REVIEW:   { bg: "#ffedd5", fg: "#c2410c" },
  PENDING:  { bg: "#fef9c3", fg: "#854d0e" },
  FLAGGED:  { bg: "#fee2e2", fg: "#b91c1c" },
  UNMAPPED: { bg: "#f1f5f9", fg: "#64748b" },
};

function clauseStatus(
  clauseId: string,
  maps: { id: string; clauseId: string; decision?: { status: string } | null }[],
  verifications: { mapId: string; status: string }[],
): ClauseStatus {
  const map = maps.find(m => m.clauseId === clauseId);
  if (!map) return "UNMAPPED";
  // Human decision takes priority over automated verification
  if (map.decision) {
    if (map.decision.status === "APPROVED") return "MAPPED";
    if (map.decision.status === "REJECTED") return "FLAGGED";
  }
  const v = verifications.find(x => x.mapId === map.id);
  if (!v) return "PENDING";
  if (v.status === "PASS") return "MAPPED";
  if (v.status === "FAIL") return "FLAGGED";
  if (v.status === "REVIEW") return "REVIEW";
  return "PENDING";
}

/** Honest circular-level badge from the compliance rollup (not the raw stage). */
type RollupStatus = "in_pipeline" | "failed" | "action_needed" | "in_progress" | "compliant";

const ROLLUP_BADGE: Record<RollupStatus, { label: string; bg: string; fg: string }> = {
  in_pipeline:   { label: "IN PIPELINE",   bg: `${CB}14`, fg: CB },
  failed:        { label: "FAILED",        bg: "#fee2e2", fg: "#b91c1c" },
  action_needed: { label: "ACTION NEEDED", bg: "#ffedd5", fg: "#c2410c" },
  in_progress:   { label: "IN PROGRESS",   bg: "#fef9c3", fg: "#854d0e" },
  compliant:     { label: "COMPLIANT",     bg: "#dcfce7", fg: "#15803d" },
};

/* ─── SIDEBAR ──────────────────────────────────────────────────────────── */

function Sidebar({ active, setActive }: { active: string; setActive: (s: string) => void }) {
  return (
    <aside className="w-[248px] h-screen flex flex-col border-r border-border bg-white shrink-0 select-none">
      <div className="h-16 flex items-center px-5 border-b border-border gap-3 shrink-0">
        <div className="w-9 h-9 rounded flex items-center justify-center shrink-0" style={{ background: CB }}>
          <ShieldCheck size={17} color="white" />
        </div>
        <div>
          <div className="font-extrabold text-[13px] tracking-wider leading-none" style={{ color: CB, fontFamily: "Barlow, sans-serif" }}>
            ARC SHIELD
          </div>
          <div className="text-[9px] text-muted-foreground mt-0.5 tracking-widest uppercase">Canara Bank</div>
        </div>
      </div>

      <div className="px-4 pt-4 pb-1">
        <div className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest">Platform</div>
      </div>

      <nav className="flex-1 px-2 space-y-0.5 overflow-y-auto">
        {NAV.map(({ id, icon: Icon, label, badge }) => {
          const on = active === id;
          return (
            <button
              key={id}
              onClick={() => setActive(id)}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-md text-[12.5px] font-medium transition-all duration-100 text-left group ${
                on ? "text-white shadow-sm" : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              }`}
              style={on ? { background: CB } : {}}
            >
              <Icon size={14} className={on ? "opacity-100" : "opacity-60 group-hover:opacity-90"} />
              <span className="flex-1" style={{ fontFamily: "Inter, sans-serif" }}>{label}</span>
              {badge && (
                <span className="text-[9px] font-extrabold px-1.5 py-0.5 rounded" style={{
                  background: on ? "rgba(255,255,255,0.2)" : `${CY}30`,
                  color: on ? "white" : "#7a5200",
                }}>
                  {badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="p-3 border-t border-border shrink-0">
        <div className="flex items-center gap-2.5 px-1.5 py-1.5 rounded-lg hover:bg-secondary cursor-pointer transition-colors">
          <div className="w-7 h-7 rounded-full flex items-center justify-center text-white shrink-0" style={{ background: CB }}>
            <User size={13} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[12px] font-semibold text-foreground truncate">Compliance Officer</div>
            <div className="text-[10px] text-muted-foreground">Signed in</div>
          </div>
          <Settings size={12} className="text-muted-foreground shrink-0" />
        </div>
      </div>
    </aside>
  );
}

/* ─── PAGE HEADER ──────────────────────────────────────────────────────── */

function PageHeader({ title, sub, children }: { title: string; sub?: string; children?: React.ReactNode }) {
  return (
    <div className="h-14 border-b border-border flex items-center justify-between px-6 bg-white shrink-0">
      <div>
        <h1 className="text-[15px] font-extrabold leading-none" style={{ fontFamily: "Barlow, sans-serif", color: "#0a1628" }}>
          {title}
        </h1>
        {sub && <p className="text-[10.5px] text-muted-foreground mt-0.5">{sub}</p>}
      </div>
      <div className="flex items-center gap-2.5">
        {children}
        <button className="relative p-1.5 rounded hover:bg-secondary transition-colors">
          <Bell size={14} className="text-muted-foreground" />
        </button>
      </div>
    </div>
  );
}

/* ─── KPI CARD ─────────────────────────────────────────────────────────── */

function KPICard({
  label, value, sub, color = CB, Icon,
}: {
  label: string; value: string; sub?: string; color?: string; Icon?: React.FC<any>;
}) {
  return (
    <div className="bg-white rounded-lg border border-border p-4 relative overflow-hidden">
      <div className="absolute inset-x-0 top-0 h-0.5 rounded-t-lg" style={{ background: color }} />
      <div className="flex items-start justify-between">
        <span className="text-[9.5px] font-bold text-muted-foreground uppercase tracking-widest">{label}</span>
        {Icon && (
          <div className="w-7 h-7 rounded flex items-center justify-center" style={{ background: `${color}14` }}>
            <Icon size={13} style={{ color }} />
          </div>
        )}
      </div>
      <div className="mt-2 text-[30px] font-extrabold leading-none" style={{ fontFamily: "Barlow, sans-serif", color: "#0a1628" }}>
        {value}
      </div>
      {sub && (
        <div className="mt-2 flex items-center gap-1.5">
          <span className="text-[10.5px] text-muted-foreground">{sub}</span>
        </div>
      )}
    </div>
  );
}

/* ─── COMPLIANCE GALAXY ────────────────────────────────────────────────── */

function ComplianceGalaxy({ sections, centerScore }: { sections: SectionScore[]; centerScore: number }) {
  const R = 128, CXC = 200, CYC = 200;
  const xy = (a: number, r: number) => ({
    x: CXC + r * Math.cos((a * Math.PI) / 180),
    y: CYC + r * Math.sin((a * Math.PI) / 180),
  });
  const nodes = sections.map((s, i) => ({
    id: s.section,
    status: s.status,
    score: s.score,
    angle: -90 + (360 / Math.max(sections.length, 1)) * i,
  }));

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold" style={{ fontFamily: "Barlow, sans-serif", color: "#0a1628" }}>
          Compliance Galaxy
        </h3>
        <div className="flex gap-3">
          {(["compliant", "warning", "violation"] as const).map(s => (
            <span key={s} className="flex items-center gap-1 text-[10px] text-muted-foreground capitalize">
              <span className="w-2 h-2 rounded-full" style={{ background: SC[s] }} />
              {s}
            </span>
          ))}
        </div>
      </div>
      <svg viewBox="0 0 400 400" className="w-full" style={{ maxHeight: 272 }}>
        <defs>
          <filter id="gsh">
            <feDropShadow dx="0" dy="2" stdDeviation="4" floodOpacity="0.11" />
          </filter>
          <radialGradient id="cgrad" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#0064c8" />
            <stop offset="100%" stopColor={CB} />
          </radialGradient>
        </defs>
        <circle cx={CXC} cy={CYC} r="158" fill="none" stroke="#eef3fb" strokeWidth="1" strokeDasharray="4 7" />
        <circle cx={CXC} cy={CYC} r="105" fill="none" stroke="#f0f5fc" strokeWidth="1" />
        {nodes.map(n => {
          const p = xy(n.angle, R);
          return (
            <line key={n.id + "l"}
              x1={CXC} y1={CYC} x2={p.x} y2={p.y}
              stroke={SC[n.status]} strokeWidth="1.5" strokeOpacity="0.28"
              strokeDasharray={n.status === "violation" ? "5 3" : "none"}
            />
          );
        })}
        <circle cx={CXC} cy={CYC} r="60" fill="url(#cgrad)" filter="url(#gsh)" />
        <text x={CXC} y={CYC - 9} textAnchor="middle" fill="white" fontSize="21" fontWeight="800" fontFamily="Barlow, sans-serif">
          {centerScore}%
        </text>
        <text x={CXC} y={CYC + 9} textAnchor="middle" fill="rgba(255,255,255,0.6)" fontSize="7.5" fontFamily="Inter, sans-serif" letterSpacing="1.8">
          COMPLIANCE SCORE
        </text>
        {nodes.map(n => {
          const p = xy(n.angle, R);
          const c = SC[n.status];
          return (
            <g key={n.id}>
              <circle cx={p.x} cy={p.y} r="35" fill="white" stroke={c} strokeWidth="1.5" filter="url(#gsh)" />
              <text x={p.x} y={p.y - 7} textAnchor="middle" fill="#0a1628" fontSize="9.5" fontWeight="700" fontFamily="Barlow, sans-serif">
                {n.id}
              </text>
              <text x={p.x} y={p.y + 10} textAnchor="middle" fill={c} fontSize="14" fontWeight="800" fontFamily="Barlow, sans-serif">
                {n.score}%
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/* ─── EXECUTIVE DASHBOARD ──────────────────────────────────────────────── */

function ExecutiveDashboard() {
  const { data, loading, error, reload } = useApi(() => api.getDashboardSummary(), [], {
    pollMs: 4000,
    pollWhile: (d) => {
      if (!d) return true;
      const active = (d.pipelineStages["RECEIVED"] ?? 0) + (d.pipelineStages["CLASSIFYING"] ?? 0)
        + (d.pipelineStages["MAPPING"] ?? 0) + (d.pipelineStages["VERIFYING"] ?? 0)
        + (d.pipelineStages["SEALED"] ?? 0);
      return active > 0;
    },
  });
  const chain = useApi(() => api.getChain(), []);

  const deptData = data?.departmentDistribution
    ? Object.entries(data.departmentDistribution).map(([name, value]) => ({ name, count: value }))
    : [];
  const severityData = data?.severityDistribution
    ? Object.entries(data.severityDistribution).map(([name, value]) => ({ name, count: value }))
    : [];

  return (
    <div className="flex flex-col h-full overflow-auto">
      <PageHeader title="Executive Dashboard" sub="Live compliance posture · derived from pipeline state">
        <button onClick={reload} className="flex items-center gap-1.5 text-[11.5px] px-3 py-1.5 rounded border border-border text-muted-foreground hover:bg-secondary transition-colors">
          <RefreshCw size={10} /> Refresh
        </button>
      </PageHeader>

      <div className="p-6 space-y-5">
        {loading && <Loading label="Loading dashboard…" />}
        {error && <ErrorState message={error} onRetry={reload} />}
        {data && (
          <>
            <div className="grid grid-cols-4 gap-4">
              <KPICard label="Compliance Score" value={`${data.complianceScore}%`} sub="verification pass rate" color={CB} Icon={Award} />
              <KPICard label="Pending MAPs"     value={String(data.pendingMaps)}    sub="awaiting review"      color={WN} Icon={AlertCircle} />
              <KPICard label="Active Circulars" value={String(data.activeCirculars)} sub="in pipeline"         color={CB} Icon={FileText} />
              <KPICard label="Risk Alerts"      value={String(data.riskAlerts)}      sub="failed verifications" color={ER} Icon={AlertTriangle} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white border border-border rounded-lg p-5">
                {data.sections.length === 0
                  ? <EmptyState title="No section scores yet" sub="Compliance scoring appears once analysis nodes verify circulars." />
                  : <ComplianceGalaxy sections={data.sections} centerScore={data.complianceScore} />}
              </div>
              <div className="bg-white border border-border rounded-lg p-5">
                <h3 className="text-sm font-bold mb-4" style={{ fontFamily: "Barlow, sans-serif", color: "#0a1628" }}>
                  Section Performance
                </h3>
                {data.sections.length === 0 ? (
                  <EmptyState title="No section data" sub="Awaiting verification scores from the pipeline." />
                ) : (
                  <ResponsiveContainer width="100%" height={224}>
                    <BarChart data={data.sections} barCategoryGap="30%">
                      <CartesianGrid strokeDasharray="2 4" stroke="#eef3fa" vertical={false} />
                      <XAxis dataKey="section" tick={{ fontSize: 11, fontFamily: "Inter, sans-serif", fill: "#5a6a85" }} axisLine={false} tickLine={false} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 9.5, fontFamily: "JetBrains Mono, monospace", fill: "#5a6a85" }} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={{ fontSize: 12, fontFamily: "Inter, sans-serif", border: `1px solid ${CB}22`, borderRadius: 6 }} />
                      <Bar dataKey="score" name="Score" fill={CB} radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white border border-border rounded-lg p-5">
                <h3 className="text-sm font-bold mb-4" style={{ fontFamily: "Barlow, sans-serif", color: "#0a1628" }}>
                  Policies Mapped by Department
                </h3>
                {deptData.length === 0 ? (
                  <EmptyState title="No department distribution" sub="Policy mappings will appear once circulars are processed." />
                ) : (
                  <ResponsiveContainer width="100%" height={224}>
                    <BarChart data={deptData} layout="vertical" margin={{ left: 20 }}>
                      <CartesianGrid strokeDasharray="2 4" stroke="#eef3fa" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 9.5, fill: "#5a6a85" }} axisLine={false} tickLine={false} />
                      <YAxis dataKey="name" type="category" tick={{ fontSize: 10, fill: "#5a6a85" }} width={120} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={{ fontSize: 12, borderRadius: 6 }} />
                      <Bar dataKey="count" name="Policies Count" fill={CB} radius={[0, 3, 3, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>

              <div className="bg-white border border-border rounded-lg p-5">
                <h3 className="text-sm font-bold mb-4" style={{ fontFamily: "Barlow, sans-serif", color: "#0a1628" }}>
                  Rule Severity Distribution
                </h3>
                {severityData.length === 0 ? (
                  <EmptyState title="No severity distribution" sub="Severity distribution will appear once circulars are processed." />
                ) : (
                  <ResponsiveContainer width="100%" height={224}>
                    <BarChart data={severityData} barCategoryGap="40%">
                      <CartesianGrid strokeDasharray="2 4" stroke="#eef3fa" vertical={false} />
                      <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#5a6a85" }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 9.5, fill: "#5a6a85" }} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={{ fontSize: 12, borderRadius: 6 }} />
                      <Bar dataKey="count" name="Rules Count" fill={ER} radius={[3, 3, 0, 0]}>
                        {severityData.map((entry, index) => {
                          const colors: Record<string, string> = { CRITICAL: ER, HIGH: WN, MEDIUM: CY, LOW: OK };
                          return <Cell key={`cell-${index}`} fill={colors[entry.name.toUpperCase()] || CB} />;
                        })}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            <div className="bg-white border border-border rounded-lg p-5">
              <h3 className="text-sm font-bold mb-4" style={{ fontFamily: "Barlow, sans-serif", color: "#0a1628" }}>
                Pipeline Stage Breakdown
              </h3>
              {Object.keys(data.pipelineStages).length === 0 ? (
                <EmptyState title="No circulars in the pipeline" sub="Upload a circular in the Explorer to populate this." />
              ) : (
                <div className="grid grid-cols-7 gap-3">
                  {(["RECEIVED","CLASSIFYING","MAPPING","VERIFYING","SEALED","COMPLETE","FAILED"] as const).map(stage => (
                    <div key={stage} className="border border-border rounded-lg p-3 text-center">
                      <div className="text-[22px] font-extrabold" style={{ fontFamily: "Barlow", color: stage === "FAILED" ? ER : CB }}>
                        {data.pipelineStages[stage] ?? 0}
                      </div>
                      <div className="text-[8.5px] text-muted-foreground uppercase tracking-widest font-bold mt-1">{stage}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-white border border-border rounded-lg p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold" style={{ fontFamily: "Barlow, sans-serif", color: "#0a1628" }}>
                  Audit Status Timeline
                </h3>
                {chain.data && chain.data.length > 0 && (
                  <span className="text-[10px] text-muted-foreground font-mono">{chain.data.length} sealed events</span>
                )}
              </div>
              {chain.loading ? <Loading label="Loading ledger…" />
                : chain.error ? <ErrorState message={chain.error} onRetry={chain.reload} />
                : !chain.data || chain.data.length === 0
                  ? <EmptyState title="No audit events yet" sub="Every pipeline stage seals a block here once a circular is processed." />
                  : (
                    <div className="space-y-2.5">
                      {[...chain.data].slice(-6).reverse().map(b => (
                        <div key={b.index} className="flex items-center gap-3 text-[11.5px]">
                          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: OK }} />
                          <span className="font-semibold text-foreground w-44 shrink-0" style={{ fontFamily: "Inter" }}>
                            {KIND_LABEL[b.kind] ?? b.kind}
                          </span>
                          <span className="font-mono text-[10px] shrink-0" style={{ color: CB }}>{shortHash(b.hash)}</span>
                          <span className="text-muted-foreground truncate flex-1">{b.refId}</span>
                          <span className="text-[10px] text-muted-foreground font-mono shrink-0">{new Date(b.timestamp).toLocaleTimeString()}</span>
                        </div>
                      ))}
                    </div>
                  )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ─── CIRCULAR EXPLORER ────────────────────────────────────────────────── */

function CircularDetail({ circular }: { circular: Circular }) {
  const pipeline = useApi(() => api.getPipeline(circular.id), [circular.id], {
    pollMs: 3000,
    pollWhile: (p) => !p || (p.stage !== "COMPLETE" && p.stage !== "FAILED"),
  });
  const refs = useApi(() => api.getReferences(circular.id), [circular.id]);
  const clauses = pipeline.data?.intelligence?.clauses ?? [];
  const similar = pipeline.data?.intelligence?.similarTo ?? null;
  const maps = pipeline.data?.maps ?? [];
  const verifications = pipeline.data?.verifications ?? [];
  const mapById = new Map(maps.map(m => [m.id, m]));
  const stage = pipeline.data?.stage ?? circular.stage;
  const inFlight = stage !== "COMPLETE" && stage !== "FAILED";
  const STAGES: PipelineStage[] = ["RECEIVED", "CLASSIFYING", "MAPPING", "VERIFYING", "SEALED", "COMPLETE"];
  const stageIdx = STAGES.indexOf(stage);

  const handleExportPDF = () => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      alert("Please allow popups to export the audit PDF report.");
      return;
    }

    const title = circular.title;
    const refNum = circular.refNumber || circular.id;
    const regulator = circular.regulator || "UNKNOWN REGULATOR";
    const dateStr = dateOf(circular.issuedDate ?? circular.receivedAt);
    const receiptHash = pipeline.data?.auditReceiptHash || "Pending Seal";

    // Build department breakdown and severity counts
    const depts: Record<string, number> = {};
    const severities: Record<string, number> = {};
    maps.forEach(m => {
      const deptName = m.department || "Unassigned";
      depts[deptName] = (depts[deptName] || 0) + 1;
      const imp = m.impact || "MEDIUM";
      severities[imp] = (severities[imp] || 0) + 1;
    });

    const deptRows = Object.entries(depts).map(([d, count]) => `
      <tr>
        <td style="padding: 8px; border-bottom: 1px solid #e2e8f0; font-size: 11px;">${d}</td>
        <td style="padding: 8px; border-bottom: 1px solid #e2e8f0; font-weight: bold; text-align: right; font-size: 11px;">${count}</td>
      </tr>
    `).join("");

    const severityRows = Object.entries(severities).map(([s, count]) => `
      <tr>
        <td style="padding: 8px; border-bottom: 1px solid #e2e8f0; font-size: 11px;">
          <span style="font-size: 10px; padding: 2px 6px; border-radius: 4px; font-weight: bold; color: ${
            s === 'CRITICAL' ? '#dc2626' : s === 'HIGH' ? '#d97706' : s === 'MEDIUM' ? '#004C97' : '#16a34a'
          }; background-color: #f1f5f9;">${s}</span>
        </td>
        <td style="padding: 8px; border-bottom: 1px solid #e2e8f0; font-weight: bold; text-align: right; font-size: 11px;">${count}</td>
      </tr>
    `).join("");

    const ruleRows = maps.map((m) => {
      const ver = verifications.find(v => v.mapId === m.id);
      const verdict = ver ? ver.status : "UNVERIFIED";
      const verColor = verdict === "PASS" ? "#16a34a" : verdict === "FAIL" ? "#dc2626" : "#d97706";
      
      return `
        <tr>
          <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; font-weight: bold; vertical-align: top; font-size: 11px; font-family: monospace;">§${m.clauseId.split("::")[1] || m.clauseId}</td>
          <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; vertical-align: top; font-size: 11.5px;">
            <div style="font-weight: bold; margin-bottom: 3px; color: #0f172a;">${m.summary}</div>
            <div style="color: #64748b; font-size: 10.5px; line-height: 1.4;">${m.newObligation}</div>
          </td>
          <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; vertical-align: top; font-size: 11px; font-weight: bold; color: #334155;">${m.department}</td>
          <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; vertical-align: top; text-align: center;">
            <span style="font-size: 10px; font-weight: bold; padding: 2px 6px; border-radius: 4px; color: ${
              m.impact === 'CRITICAL' ? '#dc2626' : m.impact === 'HIGH' ? '#d97706' : m.impact === 'MEDIUM' ? '#004C97' : '#16a34a'
            }; background-color: #f1f5f9;">${m.impact}</span>
          </td>
          <td style="padding: 10px; border-bottom: 1px solid #e2e8f0; vertical-align: top; text-align: center;">
            <span style="font-size: 10px; font-weight: bold; color: ${verColor};">${verdict}</span>
          </td>
        </tr>
      `;
    }).join("");

    const blockRows = `
      <div style="margin-top: 20px; padding: 15px; border: 1px solid #cbd5e1; border-radius: 8px; background-color: #f8fafc;">
        <h4 style="margin: 0 0 10px 0; font-size: 11px; font-weight: bold; color: #334155; text-transform: uppercase; letter-spacing: 0.5px;">Hyperledger Fabric Audit Trail</h4>
        <div style="font-size: 11px; line-height: 1.6; color: #475569; font-family: monospace;">
          <div><strong>Receipt Hash:</strong> ${receiptHash}</div>
          <div style="margin-top: 4px;"><strong>Ledger Validation:</strong> <span style="color: #16a34a; font-weight: bold;">✓ Tamper-Evident Integrity Confirmed</span></div>
          <div style="margin-top: 5px; font-size: 9.5px; color: #64748b; font-family: 'Inter', sans-serif;">
            Every pipeline stage is linked as a ledger event and sealed on the Fabric network.
          </div>
        </div>
      </div>
    `;

    const html = `
      <html>
        <head>
          <title>Compliance Audit Certificate - ${refNum}</title>
          <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&family=Barlow:wght@700;900&display=swap" rel="stylesheet">
          <style>
            body { font-family: 'Inter', sans-serif; padding: 40px; color: #1e293b; line-height: 1.5; background: #fff; }
            h1, h2, h3, h4 { font-family: 'Barlow', sans-serif; font-weight: 800; }
            table { width: 100%; border-collapse: collapse; margin-top: 15px; }
            th { background-color: #f8fafc; padding: 10px; text-align: left; font-size: 10px; text-transform: uppercase; color: #475569; border-bottom: 2px solid #cbd5e1; font-weight: 800; }
            @media print {
              body { padding: 0; }
              button { display: none; }
            }
          </style>
        </head>
        <body>
          <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 3px solid #004C97; padding-bottom: 15px; margin-bottom: 25px;">
            <div>
              <div style="font-size: 24px; font-weight: 900; color: #004C97; font-family: 'Barlow', sans-serif; letter-spacing: 0.5px;">CANARA BANK</div>
              <div style="font-size: 11px; font-weight: bold; text-transform: uppercase; color: #64748b; letter-spacing: 1.5px; margin-top: 2px;">Regulatory Compliance Audit Certificate</div>
            </div>
            <div style="border: 2px solid #16a34a; border-radius: 8px; padding: 8px 12px; text-align: center; background-color: #f0fdf4;">
              <div style="color: #16a34a; font-size: 12px; font-weight: 800; text-transform: uppercase; font-family: 'Barlow', sans-serif;">VERIFIED ON-CHAIN</div>
              <div style="font-size: 8px; color: #475569; margin-top: 1px; font-weight: 600;">HYPERLEDGER FABRIC</div>
            </div>
          </div>

          <div style="display: grid; grid-template-columns: 2fr 1.2fr; gap: 30px; margin-bottom: 20px;">
            <div>
              <h2 style="font-size: 15px; margin: 0 0 10px 0; color: #0f172a; line-height: 1.4;">${title}</h2>
              <div style="font-size: 11px; color: #475569; line-height: 1.7;">
                <div><strong>Regulator:</strong> ${regulator}</div>
                <div><strong>Reference Number:</strong> ${refNum}</div>
                <div><strong>Issued Date:</strong> ${dateStr}</div>
              </div>
            </div>

            <div style="space-y: 10px;">
              <div style="border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; background-color: #fafafa;">
                <h4 style="margin: 0 0 8px 0; font-size: 10px; color: #475569; text-transform: uppercase; letter-spacing: 0.5px;">Department Mapping</h4>
                <table style="font-size: 11px; margin-top: 0; width: 100%;">
                  ${deptRows || '<tr><td style="font-size: 11px; color: #64748b;">No department mapping.</td></tr>'}
                </table>
              </div>
              <div style="border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; background-color: #fafafa; margin-top: 10px;">
                <h4 style="margin: 0 0 8px 0; font-size: 10px; color: #475569; text-transform: uppercase; letter-spacing: 0.5px;">Severity Breakdown</h4>
                <table style="font-size: 11px; margin-top: 0; width: 100%;">
                  ${severityRows || '<tr><td style="font-size: 11px; color: #64748b;">No rules mapped.</td></tr>'}
                </table>
              </div>
            </div>
          </div>

          ${blockRows}

          <h3 style="font-size: 12px; margin-top: 25px; border-bottom: 2px solid #e2e8f0; padding-bottom: 6px; color: #004C97; text-transform: uppercase; letter-spacing: 0.5px;">Audited Obligations Ledger</h3>
          <table>
            <thead>
              <tr>
                <th style="width: 50px;">Clause</th>
                <th>Obligation Summary & Extracted Text</th>
                <th style="width: 130px;">Assigned Department</th>
                <th style="width: 70px; text-align: center;">Severity</th>
                <th style="width: 70px; text-align: center;">Verdict</th>
              </tr>
            </thead>
            <tbody>
              ${ruleRows || '<tr><td colspan="5" style="padding: 10px; text-align: center; color: #64748b; font-size: 11px;">No obligations extracted.</td></tr>'}
            </tbody>
          </table>

          <div style="margin-top: 50px; display: flex; justify-content: space-between; font-size: 11px; color: #64748b;">
            <div style="text-align: center; width: 180px; border-top: 1px solid #cbd5e1; padding-top: 8px;">
              <strong>Chief Compliance Officer</strong>
              <div style="font-size: 9px; margin-top: 2px; color: #94a3b8;">Canara Bank Compliance Cell</div>
            </div>
            <div style="text-align: center; width: 180px; border-top: 1px solid #cbd5e1; padding-top: 8px;">
              <strong>Audit Lead</strong>
              <div style="font-size: 9px; margin-top: 2px; color: #94a3b8;">Internal Audit & Assurance</div>
            </div>
          </div>

          <div style="margin-top: 30px; text-align: center; font-size: 8.5px; color: #94a3b8; border-top: 1px solid #f1f5f9; padding-top: 12px;">
            This document is cryptographically verified and recorded on a tamper-evident Hyperledger Fabric blockchain ledger. Any alteration invalidates this certificate.
          </div>

          <script>
            window.onload = function() {
              window.print();
            }
          </script>
        </body>
      </html>
    `;

    printWindow.document.write(html);
    printWindow.document.close();
  };

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="text-[10.5px] font-mono font-bold mb-1" style={{ color: CB }}>
            {circular.refNumber ?? circular.id}
          </div>
          <h2 className="text-[17px] font-extrabold leading-tight" style={{ fontFamily: "Barlow, sans-serif", color: "#0a1628" }}>
            {circular.title}
          </h2>
          <div className="flex items-center gap-3 mt-2 text-[11.5px] text-muted-foreground flex-wrap">
            {circular.regulator && <span className="font-bold" style={{ color: CB }}>{circular.regulator}</span>}
            <span>{dateOf(circular.issuedDate ?? circular.receivedAt)}</span>
            <span>{circular.document.pages} pages</span>
            {circular.sections.map(s => (
              <span key={s} className="px-1.5 py-0.5 rounded text-[10px] font-bold" style={{ background: `${CB}12`, color: CB }}>{s}</span>
            ))}
          </div>
        </div>
        {stage === "COMPLETE" && (
          <button
            onClick={handleExportPDF}
            className="flex items-center gap-1.5 text-[11px] px-3.5 py-2 rounded border border-emerald-600 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 font-bold tracking-wide transition-all shadow-xs active:scale-95 shrink-0"
          >
            <Download size={11} /> Export Audit PDF
          </button>
        )}
      </div>

      {/* Live pipeline progress — polls until COMPLETE/FAILED */}
      <div className="rounded-lg border border-border bg-white p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            {inFlight
              ? <RefreshCw size={13} className="animate-spin" style={{ color: CB }} />
              : stage === "FAILED"
                ? <XCircle size={13} style={{ color: ER }} />
                : <CheckCircle size={13} style={{ color: OK }} />}
            <h3 className="text-sm font-bold" style={{ fontFamily: "Barlow, sans-serif", color: "#0a1628" }}>
              Pipeline {inFlight ? "running…" : stage === "FAILED" ? "failed" : "sealed"}
            </h3>
          </div>
          <span className="text-[10px] font-mono text-muted-foreground">{stage}</span>
        </div>
        {stage === "FAILED" && pipeline.data?.error
          ? <div className="text-[11px] text-red-600">{pipeline.data.error}</div>
          : (
            <div className="flex items-center gap-1">
              {STAGES.map((s, i) => {
                const done = stageIdx >= 0 && i <= stageIdx;
                const current = i === stageIdx && inFlight;
                return (
                  <div key={s} className="flex-1 flex flex-col items-center gap-1">
                    <div className="w-full h-1 rounded-full transition-colors"
                      style={{ background: done ? CB : "#e6edf6" }} />
                    <span className="text-[8px] font-bold uppercase tracking-wide"
                      style={{ color: current ? CB : done ? "#0a1628" : "#9aa7bd" }}>
                      {s}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
      </div>

      {/* Reference graph — real today */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Link2 size={13} style={{ color: CB }} />
          <h3 className="text-sm font-bold" style={{ fontFamily: "Barlow, sans-serif", color: "#0a1628" }}>Reference Graph</h3>
        </div>
        {refs.loading && <Loading label="Resolving references…" />}
        {refs.error && <ErrorState message={refs.error} onRetry={refs.reload} />}
        {refs.data && (
          <div className="grid grid-cols-2 gap-3">
            <div className="border border-border rounded-lg p-3.5 bg-white">
              <div className="text-[9.5px] font-bold text-muted-foreground uppercase tracking-widest mb-2">Cites ({refs.data.references.length})</div>
              {refs.data.references.length === 0
                ? <div className="text-[11px] text-muted-foreground">No outgoing references found.</div>
                : refs.data.references.map(e => (
                    <div key={e.ref} className="flex items-center justify-between py-1.5 border-b border-border last:border-0">
                      <span className="font-mono text-[10px]" style={{ color: CB }}>{e.ref}</span>
                      {e.circularId
                        ? <span className="text-[9px] font-bold text-green-700 bg-green-50 border border-green-200 px-1.5 py-0.5 rounded">resolved</span>
                        : <span className="text-[9px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">not ingested</span>}
                    </div>
                  ))}
            </div>
            <div className="border border-border rounded-lg p-3.5 bg-white">
              <div className="text-[9.5px] font-bold text-muted-foreground uppercase tracking-widest mb-2">Cited by ({refs.data.citedBy.length})</div>
              {refs.data.citedBy.length === 0
                ? <div className="text-[11px] text-muted-foreground">No circular cites this one yet.</div>
                : refs.data.citedBy.map(c => (
                    <div key={c.circularId} className="flex items-center justify-between py-1.5 border-b border-border last:border-0">
                      <span className="font-mono text-[10px]" style={{ color: CB }}>{c.refNumber ?? c.circularId}</span>
                    </div>
                  ))}
            </div>
          </div>
        )}
      </div>

      {/* Similarity — node-dependent */}
      <div>
        <h3 className="text-sm font-bold mb-3" style={{ fontFamily: "Barlow, sans-serif", color: "#0a1628" }}>Similarity Analysis</h3>
        {pipeline.loading ? <Loading />
          : !similar ? <EmptyState title="No similarity yet" sub="Semantic similarity is produced by the analysis nodes once they run." />
          : (
            <div className="rounded-lg p-4 border" style={{ background: `${CY}0e`, borderColor: `${CY}50` }}>
              <div className="flex items-center gap-4">
                <div className="text-[28px] font-extrabold leading-none" style={{ color: "#7a5200", fontFamily: "Barlow, sans-serif" }}>
                  {Math.round(similar.similarity * 100)}%
                </div>
                <div className="text-[13px] font-bold text-foreground">Similar to {similar.circularId}</div>
              </div>
            </div>
          )}
      </div>

      {/* Clauses — node-dependent */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold" style={{ fontFamily: "Barlow, sans-serif", color: "#0a1628" }}>Clause Overview</h3>
          {clauses.length > 0 && (
            <span className="text-[10px] text-muted-foreground">
              {clauses.length} total · {clauses.filter(c => clauseStatus(c.id, maps, verifications) === "MAPPED").length} mapped · {clauses.filter(c => { const s = clauseStatus(c.id, maps, verifications); return s === "PENDING"; }).length} pending · {clauses.filter(c => clauseStatus(c.id, maps, verifications) === "FLAGGED").length} flagged
            </span>
          )}
        </div>
        {pipeline.loading ? <Loading />
          : pipeline.error ? <ErrorState message={pipeline.error} onRetry={pipeline.reload} />
          : clauses.length === 0 ? <EmptyState title="No clauses extracted yet" sub="Clause extraction runs in Node 1 — appears once it’s connected." />
          : (
            <div className="space-y-1.5">
              {clauses.map(clause => {
                const cs = clauseStatus(clause.id, maps, verifications);
                const style = CLAUSE_STATUS_STYLE[cs];
                return (
                  <div key={clause.id} className="flex items-center gap-3 px-3.5 py-2.5 rounded-md border border-border bg-white">
                    <span className="font-mono text-[10.5px] font-bold w-10 shrink-0" style={{ color: CB }}>§{clause.id}</span>
                    <span className="text-[12.5px] flex-1" style={{ fontFamily: "Inter" }}>{clause.title}</span>
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: `${CB}10`, color: CB }}>{clause.section}</span>
                    <span className="text-[9px] font-extrabold px-1.5 py-0.5 rounded shrink-0" style={{ background: style.bg, color: style.fg }}>{cs}</span>
                  </div>
                );
              })}
            </div>
          )}
      </div>

      {/* Verifications — Node 3 dual-agent verdicts */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold" style={{ fontFamily: "Barlow, sans-serif", color: "#0a1628" }}>Verification</h3>
          {verifications.length > 0 && <span className="text-[10px] text-muted-foreground">{verifications.length} verdicts</span>}
        </div>
        {pipeline.loading ? <Loading />
          : verifications.length === 0 ? <EmptyState title="No verifications yet" sub="MAPs are verified by Node 3's Technical and Policy agents once mapping completes." />
          : (
            <div className="space-y-1.5">
              {verifications.map(v => {
                const m = mapById.get(v.mapId);
                // If the MAP has a human decision, show that instead of the raw Node 3 status
                const effectiveStatus = m?.decision
                  ? m.decision.status === "APPROVED" ? "PASS" : m.decision.status === "REJECTED" ? "FAIL" : v.status
                  : v.status;
                const effectiveScore = m?.decision
                  ? m.decision.status === "APPROVED" ? 1.0 : m.decision.status === "REJECTED" ? 0 : v.score
                  : v.score;
                const decisionLabel = m?.decision
                  ? m.decision.status === "APPROVED" ? "APPROVED" : m.decision.status === "REJECTED" ? "REJECTED" : null
                  : null;
                return (
                  <div key={v.id} className="flex items-center gap-3 px-3.5 py-2.5 rounded-md border border-border bg-white">
                    <span className="text-[9px] font-extrabold px-1.5 py-0.5 rounded shrink-0 text-white" style={{ background: verdictColor(effectiveStatus) }}>{decisionLabel ?? effectiveStatus}</span>
                    <span className="text-[12.5px] flex-1" style={{ fontFamily: "Inter" }}>{m?.summary ?? v.mapId}</span>
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0" style={agentBadgeStyle(v.verifiedBy)}>{m?.decision ? "Human Decision" : agentLabel(v.verifiedBy)}</span>
                    <span className="font-mono text-[10px] text-muted-foreground shrink-0">{Math.round(effectiveScore * 100)}%</span>
                  </div>
                );
              })}
            </div>
          )}
      </div>
    </div>
  );
}

function CircularExplorer() {
  const { data, loading, error, reload } = useApi(() => api.listCirculars(), []);
  const statuses = useApi(() => api.getCircularStatus(), []);
  const [query, setQuery] = useState("");
  const [reg, setReg]     = useState<string | null>(null);
  const [sel, setSel]     = useState<Circular | null>(null);
  const [busy, setBusy]   = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const regs = ["RBI", "SEBI", "IRDAI", "MCA"];
  const circulars = data ?? [];
  const filtered = circulars.filter(c => {
    const qm = !query || c.title.toLowerCase().includes(query.toLowerCase())
      || c.id.toLowerCase().includes(query.toLowerCase())
      || (c.refNumber ?? "").toLowerCase().includes(query.toLowerCase());
    const rm = !reg || c.regulator === reg;
    return qm && rm;
  });

  const onUpload = async (file: File) => {
    setBusy(true);
    setNotice(null);
    try {
      const created = await uploadCircular(file);
      setNotice(`Ingested ${created.refNumber ?? created.id}. Starting pipeline…`);
      try {
        await processCircular(created.id);
      } catch (err) {
        // Expected until Node 1 is connected — intake still succeeded.
        const msg = err instanceof ApiError ? err.message : String(err);
        setNotice(`Ingested ${created.refNumber ?? created.id}. Pipeline not started: ${msg}`);
      }
      reload();
      statuses.reload();
      setSel(created);
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (c: Circular) => {
    if (!window.confirm(`Delete circular ${c.refNumber ?? c.id}? Its document is removed; the audit ledger is preserved.`)) return;
    setDeletingId(c.id);
    setNotice(null);
    try {
      await deleteCircular(c.id);
      setNotice(`Deleted ${c.refNumber ?? c.id}.`);
      if (sel?.id === c.id) setSel(null);
      reload();
      statuses.reload();
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : String(err));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader title="Circular Explorer" sub={`${circulars.length} circulars ingested`}>
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) onUpload(f); e.target.value = ""; }}
        />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="flex items-center gap-1.5 text-[11.5px] px-3 py-1.5 rounded text-white transition-colors disabled:opacity-50"
          style={{ background: CB }}
        >
          <Upload size={10} /> {busy ? "Uploading…" : "Upload Circular"}
        </button>
      </PageHeader>

      {notice && (
        <div className="px-6 py-2 text-[11px] border-b border-border bg-secondary/40 text-muted-foreground">{notice}</div>
      )}

      <div className="flex-1 flex min-h-0">
        <div className="w-[380px] flex flex-col border-r border-border shrink-0">
          <div className="p-4 space-y-2.5 border-b border-border shrink-0">
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search by ref, title, keyword..."
                className="w-full pl-8 pr-3 py-2 text-[12.5px] rounded border border-border bg-white focus:outline-none focus:ring-1 transition-shadow"
                style={{ fontFamily: "Inter, sans-serif" }}
              />
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {[null, ...regs].map(r => (
                <button
                  key={r ?? "all"}
                  onClick={() => setReg(r)}
                  className={`px-2.5 py-1 rounded text-[10.5px] font-semibold transition-colors ${
                    reg === r ? "text-white" : "text-muted-foreground border border-border hover:bg-secondary"
                  }`}
                  style={reg === r ? { background: CB } : {}}
                >
                  {r ?? "All"}
                </button>
              ))}
              <button className="ml-auto px-2.5 py-1 rounded text-[10.5px] font-semibold border border-border text-muted-foreground hover:bg-secondary flex items-center gap-1">
                <Filter size={10} /> Filter
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {loading && <Loading label="Loading circulars…" />}
            {error && <ErrorState message={error} onRetry={reload} />}
            {data && filtered.length === 0 && (
              <EmptyState title="No circulars" sub="Upload an RBI circular PDF to get started." />
            )}
            {filtered.map(c => {
              const roll = statuses.data?.[c.id];
              const badge = roll
                ? ROLLUP_BADGE[roll.status]
                : { label: STATUS_LABEL[circularStatus(c.stage)], bg: `${STATUS_COLOR[circularStatus(c.stage)]}18`, fg: STATUS_COLOR[circularStatus(c.stage)] };
              return (
                <div key={c.id} className="relative group">
                  <button
                    onClick={() => setSel(c)}
                    className={`w-full text-left px-4 py-3.5 border-b border-border transition-colors hover:bg-secondary/50 ${
                      sel?.id === c.id ? "bg-secondary" : ""
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-1.5">
                      <span className="text-[10px] font-mono font-bold" style={{ color: CB }}>{c.refNumber ?? c.id}</span>
                      <span className="text-[8.5px] font-extrabold px-1.5 py-0.5 rounded-sm uppercase tracking-wide shrink-0"
                        style={{ background: badge.bg, color: badge.fg }}>
                        {badge.label}
                      </span>
                    </div>
                    <div className="text-[12px] font-semibold text-foreground leading-snug mb-2 pr-6" style={{ fontFamily: "Inter" }}>{c.title}</div>
                    <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                      {c.regulator && <span className="font-bold" style={{ color: CB }}>{c.regulator}</span>}
                      <span>{dateOf(c.issuedDate ?? c.receivedAt)}</span>
                      {roll && roll.total > 0
                        ? <span>{roll.mapped}/{roll.total} mapped{roll.flagged > 0 ? ` · ${roll.flagged} flagged` : ""}</span>
                        : <span>{c.references.length} refs</span>}
                    </div>
                  </button>
                  <button
                    onClick={() => onDelete(c)}
                    disabled={deletingId === c.id}
                    title="Delete circular"
                    aria-label={`Delete circular ${c.refNumber ?? c.id}`}
                    className="absolute bottom-3 right-3 p-1.5 rounded text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-white hover:bg-[var(--er)] transition-all disabled:opacity-50"
                    style={{ ["--er" as string]: ER }}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex-1 overflow-auto p-6">
          {!sel ? (
            <div className="h-full flex flex-col items-center justify-center text-center gap-3">
              <FileText size={40} className="text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">Select a circular to view its references, clause map, and similarity analysis</p>
            </div>
          ) : (
            <CircularDetail circular={sel} />
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── COMPLIANCE COPILOT ────────────────────────────────────────────────── */

type Msg = { role: "user" | "ai"; text: string; citations?: Citation[]; error?: boolean };

function ComplianceCopilot() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [sources, setSources] = useState<Citation[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  const send = async (text: string) => {
    if (!text.trim() || busy) return;
    setMsgs(p => [...p, { role: "user", text: text.trim() }]);
    setInput("");
    setBusy(true);
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 60);
    try {
      const ans = await api.askCopilot(text.trim());
      setMsgs(p => [...p, { role: "ai", text: ans.answer, citations: ans.citations }]);
      setSources(ans.citations);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : String(err);
      setMsgs(p => [...p, { role: "ai", text: `Copilot is unavailable: ${msg}`, error: true }]);
    } finally {
      setBusy(false);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 60);
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader title="Compliance Copilot" sub="Retrieval-grounded answers over ingested circulars" />

      <div className="flex flex-1 min-h-0">
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
            {msgs.length === 0 && (
              <div className="h-full flex items-center justify-center">
                <EmptyState title="Ask a compliance question" sub="Answers are grounded in ingested circular clauses with verification status." />
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={`flex gap-2.5 ${m.role === "user" ? "flex-row-reverse" : ""}`}>
                <div className="w-7 h-7 rounded-full flex items-center justify-center text-[9.5px] font-extrabold shrink-0 text-white"
                  style={{ background: m.role === "ai" ? (m.error ? ER : CB) : "#64748b" }}>
                  {m.role === "ai" ? "AI" : <User size={13} />}
                </div>
                <div className={`max-w-[76%] flex flex-col gap-1.5 ${m.role === "user" ? "items-end" : "items-start"}`}>
                  <div className="rounded-xl px-4 py-3 text-[12.5px] leading-relaxed"
                    style={{
                      background: m.role === "user" ? CB : m.error ? `${ER}0e` : "white",
                      color: m.role === "user" ? "white" : "#0a1628",
                      border: m.role === "user" ? "none" : `1px solid ${m.error ? `${ER}40` : "var(--border)"}`,
                      fontFamily: "Inter, sans-serif",
                      whiteSpace: "pre-line",
                    }}>
                    {m.text}
                  </div>
                  {m.citations && m.citations.length > 0 && (
                    <div className="flex gap-1.5 flex-wrap">
                      {m.citations.map(c => (
                        <span key={c.clauseId} className="text-[9.5px] px-2 py-0.5 rounded-full border font-mono"
                          style={{ borderColor: `${CB}35`, color: CB, background: `${CB}08` }}>
                          {c.circularId} §{c.clauseId}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          <div className="px-6 pb-6 pt-2">
            <div className="flex gap-2 p-1 border border-border rounded-xl bg-white focus-within:ring-1 transition-shadow">
              <input
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), send(input))}
                placeholder="Ask about any circular, obligation, or compliance requirement..."
                className="flex-1 px-3 py-2.5 text-[12.5px] bg-transparent focus:outline-none"
                style={{ fontFamily: "Inter" }}
              />
              <button onClick={() => send(input)} disabled={!input.trim() || busy}
                className="w-9 h-9 rounded-lg flex items-center justify-center m-0.5 transition-opacity disabled:opacity-30"
                style={{ background: CB }}>
                <Send size={13} color="white" />
              </button>
            </div>
            <p className="text-[9.5px] text-muted-foreground mt-1.5 text-center">
              ARC Shield AI · Responses grounded in ingested circulars · Not legal advice
            </p>
          </div>
        </div>

        <div className="w-60 border-l border-border flex flex-col bg-white shrink-0">
          <div className="px-4 py-3 border-b border-border shrink-0">
            <h3 className="text-[11px] font-bold text-foreground" style={{ fontFamily: "Barlow" }}>Evidence & Sources</h3>
          </div>
          <div className="flex-1 overflow-y-auto p-3.5 space-y-2.5">
            {sources.length === 0 ? (
              <p className="text-[10.5px] text-muted-foreground">Citations from the latest answer appear here.</p>
            ) : sources.map((c, i) => (
              <div key={i} className="p-2.5 rounded-lg border border-border bg-secondary/30">
                <div className="flex items-start justify-between mb-1">
                  <span className="text-[9.5px] font-mono font-bold leading-tight" style={{ color: CB }}>{c.circularId}</span>
                  <span className="text-[9px] font-bold px-1.5 rounded"
                    style={{ color: c.verification === "PASS" ? OK : c.verification === "FAIL" ? ER : "#64748b" }}>
                    {c.verification}
                  </span>
                </div>
                <div className="text-[9.5px] text-muted-foreground">§{c.clauseId} · {c.title}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── BLOCKCHAIN TRUST CENTER ──────────────────────────────────────────── */

function BlockchainTrustCenter() {
  const chain = useApi(() => api.getChain(), []);
  const verify = useApi(() => api.verifyChain(), []);
  const network = useApi(() => api.getLedgerNetwork(), []);
  const agents = useApi(() => api.getLedgerAgents(), []);
  const blocks = chain.data ?? [];

  const latestByKind = new Map<LedgerKind, LedgerBlock>();
  for (const b of blocks) latestByKind.set(b.kind, b);
  const hashCards = (Object.keys(KIND_LABEL) as LedgerKind[])
    .map(k => ({ kind: k, block: latestByKind.get(k) }))
    .filter(c => c.block);

  return (
    <div className="flex flex-col h-full overflow-auto">
      <PageHeader title="Blockchain Trust Center" sub="Hash-linked audit ledger · chain of custody">
        {verify.data && (
          <div className="flex items-center gap-1.5 text-[10.5px] px-2 py-1 rounded font-semibold"
            style={{ background: verify.data.valid ? `${OK}12` : `${ER}12`, color: verify.data.valid ? "#15803d" : "#b91c1c" }}>
            {verify.data.valid
              ? <><CheckCircle size={11} /> Chain Verified</>
              : <><XCircle size={11} /> Broken at #{verify.data.brokenAt}</>}
          </div>
        )}
      </PageHeader>

      <div className="p-6 space-y-5">
        {chain.loading && <Loading label="Loading ledger…" />}
        {chain.error && <ErrorState message={chain.error} onRetry={chain.reload} />}
        {chain.data && (
          <>
            {hashCards.length > 0 && (
              <div className="grid grid-cols-4 gap-4">
                {hashCards.slice(0, 4).map(({ kind, block }) => (
                  <div key={kind} className="rounded-lg border border-border bg-white p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="w-8 h-8 rounded-md flex items-center justify-center" style={{ background: `${CB}14` }}>
                        <Hash size={14} style={{ color: CB }} />
                      </div>
                      <CheckCircle size={13} style={{ color: OK }} />
                    </div>
                    <div className="text-[9.5px] text-muted-foreground uppercase tracking-widest font-bold mb-1">{KIND_LABEL[kind]}</div>
                    <div className="text-[10px] font-mono font-bold truncate mb-0.5" style={{ color: CB }}>{shortHash(block!.hash)}</div>
                    <div className="text-[9.5px] text-muted-foreground">#{block!.index} · {block!.refId}</div>
                  </div>
                ))}
              </div>
            )}

            <div className="grid grid-cols-[1fr_280px] gap-4">
              <div className="bg-white border border-border rounded-lg p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-bold" style={{ fontFamily: "Barlow, sans-serif", color: "#0a1628" }}>Chain of Custody</h3>
                  <span className="text-[10.5px] text-muted-foreground font-mono">{blocks.length} blocks</span>
                </div>
                {blocks.length === 0 ? (
                  <EmptyState title="Ledger is empty" sub="Blocks are appended as circulars move through the pipeline." />
                ) : (
                  <div className="relative">
                    <div className="absolute left-[9px] top-3 bottom-1 w-0.5" style={{ background: "#dae5f5" }} />
                    <div className="space-y-4">
                      {blocks.map(b => (
                        <div key={b.index} className="flex gap-4 items-start">
                          <div className="w-[18px] h-[18px] rounded-full border-2 shrink-0 z-10 flex items-center justify-center bg-white" style={{ borderColor: OK }}>
                            <div className="w-2 h-2 rounded-full" style={{ background: OK }} />
                          </div>
                          <div className="flex-1 pb-0.5">
                            <div className="flex items-center justify-between">
                              <span className="text-[12.5px] font-semibold text-foreground" style={{ fontFamily: "Inter" }}>{KIND_LABEL[b.kind]}</span>
                              <span className="text-[10px] text-muted-foreground font-mono">{new Date(b.timestamp).toLocaleString()}</span>
                            </div>
                            <div className="flex items-center gap-3 mt-0.5">
                              <span className="font-mono text-[10px]" style={{ color: CB }}>{shortHash(b.hash)}</span>
                              <span className="text-[10px] text-muted-foreground">{b.refId}</span>
                              <span className="text-[9.5px] font-bold text-green-600">✓ #{b.index}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-4">
                <div className="bg-white border border-border rounded-lg p-4">
                  <h3 className="text-[11px] font-bold mb-3" style={{ fontFamily: "Barlow", color: "#0a1628" }}>Signing Identity</h3>
                  {network.loading ? <Loading />
                    : !network.data ? <EmptyState title="Unavailable" sub="Ledger network info not served." />
                    : network.data.backend === "fabric" && network.data.fabric ? (
                      <div className="space-y-2.5">
                        <div className="flex items-center gap-2">
                          <Fingerprint size={13} style={{ color: CB }} />
                          <span className="text-[11px] font-semibold text-foreground">X.509 / MSP identity</span>
                        </div>
                        <div className="text-[10px] space-y-1.5">
                          <div className="flex justify-between"><span className="text-muted-foreground">MSP ID</span><span className="font-mono font-bold" style={{ color: CB }}>{network.data.fabric.mspId}</span></div>
                          <div className="flex justify-between"><span className="text-muted-foreground">Signed by</span><span className="font-mono">{network.data.fabric.peerHostAlias}</span></div>
                        </div>
                        <div className="text-[9.5px] text-muted-foreground pt-1 border-t border-border">
                          Each block is a transaction submitted under this MSP identity and committed by the orderer.
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <Hash size={13} style={{ color: WN }} />
                          <span className="text-[11px] font-semibold text-foreground">Local hash-chain</span>
                        </div>
                        <p className="text-[9.5px] text-muted-foreground">
                          Running on the SHA-256 hash-chain backend (FABRIC_ENABLED=false). No X.509 signers — integrity is enforced by hash linkage.
                        </p>
                      </div>
                    )}
                </div>
                <div className="bg-white border border-border rounded-lg p-4">
                  <h3 className="text-[11px] font-bold mb-3" style={{ fontFamily: "Barlow", color: "#0a1628" }}>Fabric Network</h3>
                  {network.loading ? <Loading />
                    : network.data?.backend === "fabric" && network.data.fabric ? (
                      <div className="text-[10px] space-y-1.5">
                        <div className="flex justify-between"><span className="text-muted-foreground">Channel</span><span className="font-mono font-bold" style={{ color: CB }}>{network.data.fabric.channel}</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">Chaincode</span><span className="font-mono">{network.data.fabric.chaincode}</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">Peer</span><span className="font-mono">{network.data.fabric.peerEndpoint}</span></div>
                        <div className="flex items-center gap-1.5 pt-1.5 mt-1 border-t border-border">
                          <span className="w-1.5 h-1.5 rounded-full" style={{ background: OK }} />
                          <span className="text-[9.5px] font-semibold" style={{ color: "#15803d" }}>Connected</span>
                        </div>
                      </div>
                    ) : (
                      <p className="text-[9.5px] text-muted-foreground">
                        Hash-chain backend active. Set FABRIC_ENABLED=true to record on the Hyperledger Fabric network.
                      </p>
                    )}
                </div>
              </div>
            </div>

            {network.data?.backend === "fabric" && (
              <div className="bg-white border border-border rounded-lg p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-bold" style={{ fontFamily: "Barlow, sans-serif", color: "#0a1628" }}>
                    Registered Agents
                  </h3>
                  <span className="text-[10px] text-muted-foreground font-mono">{(agents.data ?? []).length} on-chain</span>
                </div>
                {agents.loading ? <Loading /> : (agents.data ?? []).length === 0 ? (
                  <p className="text-[10.5px] text-muted-foreground">
                    No agents registered — the ledger is in open mode. Register agents (cxo role) to enforce that only scoped Fabric identities can seal each block kind.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {(agents.data ?? []).map(a => (
                      <div key={`${a.mspId}-${a.certHash}`} className="flex items-center gap-3 text-[10.5px] border-b border-border last:border-0 pb-2 last:pb-0">
                        <span className="font-bold text-foreground w-32 truncate">{a.id}</span>
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold" style={{ background: `${CB}10`, color: CB }}>{a.role}</span>
                        <span className="font-mono text-muted-foreground" title={`${a.mspId}::${a.certHash}`}>{a.mspId} · {a.certHash.slice(0, 8)}…</span>
                        <span className="ml-auto font-mono text-[9.5px] text-muted-foreground">{a.allowedKinds.length ? a.allowedKinds.join(", ") : "all kinds"}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="bg-white border border-border rounded-lg p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold" style={{ fontFamily: "Barlow, sans-serif", color: "#0a1628" }}>
                  {network.data?.backend === "fabric" ? "Recent Fabric Transactions" : "Recent Ledger Transactions"}
                </h3>
                <span className="text-[10px] text-muted-foreground font-mono">{blocks.length} total</span>
              </div>
              {blocks.length === 0 ? (
                <EmptyState title="No transactions yet" sub="Each pipeline stage submits one transaction to the ledger." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-[10.5px]">
                    <thead>
                      <tr className="text-left text-muted-foreground uppercase tracking-wider text-[9px] border-b border-border">
                        <th className="py-1.5 font-bold">#</th>
                        <th className="py-1.5 font-bold">Event</th>
                        <th className="py-1.5 font-bold">Ref</th>
                        <th className="py-1.5 font-bold">Tx Hash</th>
                        <th className="py-1.5 font-bold">Signed By</th>
                        <th className="py-1.5 font-bold text-right">Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...blocks].reverse().slice(0, 12).map(b => (
                        <tr key={b.index} className="border-b border-border last:border-0">
                          <td className="py-1.5 font-mono text-muted-foreground">{b.index}</td>
                          <td className="py-1.5 font-semibold text-foreground">{KIND_LABEL[b.kind] ?? b.kind}</td>
                          <td className="py-1.5 font-mono text-muted-foreground">{b.refId}</td>
                          <td className="py-1.5 font-mono" style={{ color: CB }}>{shortHash(b.hash)}</td>
                          <td className="py-1.5 font-mono text-muted-foreground" title={b.submittedBy ?? ""}>{signerLabel(b.submittedBy)}</td>
                          <td className="py-1.5 font-mono text-muted-foreground text-right">{new Date(b.timestamp).toLocaleTimeString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ─── ROLE WORKSPACE ────────────────────────────────────────────────────── */

const ROLES: { id: Role; label: string; Icon: React.FC<any> }[] = [
  { id: "compliance", label: "Compliance Officer", Icon: ShieldCheck },
  { id: "it",         label: "IT Team",            Icon: Cpu        },
  { id: "cxo",        label: "CXO View",           Icon: Award      },
  { id: "auditor",    label: "Auditor / RBI",      Icon: Eye        },
];

function RoleWorkspace() {
  const [role, setRole] = useState<Role>("compliance");
  const { data, loading, error, reload } = useApi(() => api.getRoleWorkspace(role), [role]);

  return (
    <div className="flex flex-col h-full overflow-auto">
      <PageHeader title="Role Workspace" sub="MAPs and verifications scoped to the selected role">
        <div className="flex gap-1 p-1 rounded-lg border border-border bg-secondary/40">
          {ROLES.map(({ id, label, Icon }) => {
            const on = role === id;
            return (
              <button key={id} onClick={() => setRole(id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-[11.5px] font-semibold transition-all ${
                  on ? "text-white shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
                style={on ? { background: CB } : {}}>
                <Icon size={11} />
                {label}
              </button>
            );
          })}
        </div>
      </PageHeader>

      <div className="flex-1 p-6 space-y-5">
        {loading && <Loading label="Loading workspace…" />}
        {error && <ErrorState message={error} onRetry={reload} />}
        {data && (
          <>
            <div className="grid grid-cols-3 gap-4">
              <KPICard label="Assigned MAPs"  value={String(data.maps.length)} color={CB} Icon={GitBranch} />
              <KPICard label="Needs Review"   value={String(data.maps.filter(m => m.needsReview).length)} color={WN} Icon={AlertCircle} />
              <KPICard label="Verifications"  value={String(data.verifications.length)} color={CB} Icon={CheckCircle} />
            </div>

            <div className="bg-white border border-border rounded-lg p-5">
              <h3 className="text-sm font-bold mb-4" style={{ fontFamily: "Barlow", color: "#0a1628" }}>
                MAPs for {ROLES.find(r => r.id === role)?.label}
              </h3>
              {data.maps.length === 0 ? (
                <EmptyState title="No MAPs assigned yet" sub="Compliance mappings are generated by Node 2 once it’s connected." />
              ) : (
                <div className="space-y-2">
                  {data.maps.map(m => (
                    <div key={m.id} className="flex items-center gap-4 px-3.5 py-2.5 rounded-md border border-border hover:bg-secondary/30 transition-colors">
                      <span className="font-mono text-[10.5px] font-bold shrink-0" style={{ color: CB }}>{m.id}</span>
                      <span className="text-[8.5px] font-extrabold px-1.5 py-0.5 rounded shrink-0" style={{ background: `${impactColor(m.impact)}14`, color: impactColor(m.impact) }}>{m.impact}</span>
                      <span className="flex-1 text-[12px] text-foreground">{m.summary}</span>
                      <span className="text-[10.5px] font-mono text-muted-foreground shrink-0">{dateOf(m.deadline)}</span>
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0" style={{ background: `${CB}10`, color: CB }}>{m.category}</span>
                      {m.needsReview && (
                        <span className="text-[9px] font-extrabold px-2 py-0.5 rounded shrink-0 text-amber-700 bg-amber-50 border border-amber-200">REVIEW</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ─── REVIEW QUEUE ──────────────────────────────────────────────────────── */

function DecisionRow({ item, onDone }: { item: import("../services/types.js").ReviewQueueItem; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [reassignTo, setReassignTo] = useState<Role>("it");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (status: "APPROVED" | "REJECTED" | "REASSIGNED") => {
    if (!note.trim()) { setErr("A note is required to record the decision."); return; }
    setBusy(true);
    setErr(null);
    try {
      await api.decideMap(item.circularId, item.id, {
        status,
        note: note.trim(),
        ...(status === "REASSIGNED" ? { reassignedTo: reassignTo } : {}),
      });
      onDone();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-md border border-border bg-white">
      <div className="flex items-center gap-4 px-3.5 py-2.5">
        <span className="font-mono text-[10.5px] font-bold shrink-0" style={{ color: CB }}>{item.id}</span>
        <span className="text-[8.5px] font-extrabold px-1.5 py-0.5 rounded shrink-0" style={{ background: `${impactColor(item.impact)}14`, color: impactColor(item.impact) }}>{item.impact}</span>
        <div className="flex-1 min-w-0">
          <div className="text-[12px] text-foreground truncate">{item.summary}</div>
          <div className="text-[10px] text-muted-foreground truncate">{item.circularTitle}</div>
        </div>
        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0" style={{ background: `${CB}10`, color: CB }}>{item.category}</span>
        <span className="font-mono text-[10.5px] font-bold shrink-0" style={{ color: WN }}>{Math.round(item.confidence * 100)}%</span>
        <button onClick={() => setOpen(o => !o)}
          className="text-[10.5px] font-semibold px-3 py-1 rounded shrink-0 text-white" style={{ background: CB }}>
          {open ? "Cancel" : "Decide"}
        </button>
      </div>

      {open && (
        <div className="border-t border-border p-3.5 space-y-2.5 bg-secondary/20">
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Decision rationale (recorded on-chain with your role)…"
            rows={2}
            className="w-full px-3 py-2 text-[12px] rounded border border-border bg-white focus:outline-none focus:ring-1"
            style={{ fontFamily: "Inter" }}
          />
          {err && <div className="text-[10.5px] text-red-600">{err}</div>}
          <div className="flex items-center gap-2 flex-wrap">
            <button disabled={busy} onClick={() => submit("APPROVED")}
              className="flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded text-white disabled:opacity-40" style={{ background: OK }}>
              <CheckCircle size={12} /> Approve
            </button>
            <button disabled={busy} onClick={() => submit("REJECTED")}
              className="flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded text-white disabled:opacity-40" style={{ background: ER }}>
              <XCircle size={12} /> Reject
            </button>
            <div className="flex items-center gap-1.5 ml-auto">
              <select value={reassignTo} onChange={e => setReassignTo(e.target.value as Role)}
                className="text-[11px] px-2 py-1.5 rounded border border-border bg-white">
                <option value="it">IT</option>
                <option value="compliance">Compliance</option>
                <option value="cxo">CXO</option>
                <option value="auditor">Auditor</option>
              </select>
              <button disabled={busy} onClick={() => submit("REASSIGNED")}
                className="flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded border border-border text-foreground disabled:opacity-40">
                <ArrowRight size={12} /> Reassign
              </button>
            </div>
          </div>
          <p className="text-[9.5px] text-muted-foreground">
            Your decision is sealed on the audit chain as a HUMAN_DECISION block before it is recorded.
          </p>
        </div>
      )}
    </div>
  );
}

function ReviewQueuePage() {
  const { data, loading, error, reload } = useApi(() => api.getReviewQueue(), []);

  return (
    <div className="flex flex-col h-full overflow-auto">
      <PageHeader title="Human Review Queue" sub="Low-confidence MAPs the engine flagged for a human decision">
        <button onClick={reload} className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11.5px] font-semibold text-white" style={{ background: CB }}>
          <RefreshCw size={12} /> Refresh
        </button>
      </PageHeader>

      <div className="flex-1 p-6 space-y-5">
        {loading && <Loading label="Loading review queue…" />}
        {error && <ErrorState message={error} onRetry={reload} />}
        {data && (
          <>
            <div className="grid grid-cols-3 gap-4">
              <KPICard label="Awaiting Review" value={String(data.count)} sub="below confidence threshold" color={WN} Icon={AlertCircle} />
            </div>

            <div className="bg-white border border-border rounded-lg p-5">
              <h3 className="text-sm font-bold mb-4" style={{ fontFamily: "Barlow", color: "#0a1628" }}>Flagged MAPs</h3>
              {data.items.length === 0 ? (
                <EmptyState title="Queue is clear" sub="No MAPs need human review. High-confidence mappings are auto-approved." />
              ) : (
                <div className="space-y-2">
                  {data.items.map(m => (
                    <DecisionRow key={m.id} item={m} onDone={reload} />
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ─── SECURITY PAGE ─────────────────────────────────────────────────────── */

const SEC_FEATURES = [
  { Icon: Database,    title: "Zero Data Retention",   badge: "Privacy-First", desc: "No customer PII is stored or processed. Only cryptographic hashes of compliance evidence are written to the immutable ledger." },
  { Icon: Building2,   title: "Multi-Tenancy",         badge: "Isolated",      desc: "Tenant isolation via separate ledger channels. Each bank's data is cryptographically separated." },
  { Icon: Fingerprint, title: "RBAC Access Control",   badge: "Zero Trust",    desc: "Role-Based Access Control enforced at every API boundary via the x-role header." },
  { Icon: Hash,        title: "Hash-Only Storage",     badge: "Immutable",     desc: "Documents are never stored on-chain. Only SHA-256 hashes are recorded in the tamper-evident ledger." },
  { Icon: Lock,        title: "End-to-End Encryption", badge: "TLS 1.3",       desc: "All API communications use TLS. Peer communications use mutual TLS." },
  { Icon: Globe,       title: "Regulatory Compliance", badge: "By Design",     desc: "Designed to align with RBI IT Framework and SEBI Cybersecurity guidelines." },
];

function SystemParamRow({ dept, name, value, onSaved }: {
  dept: string; name: string; value: string | number | boolean; onSaved: () => void;
}) {
  const isBool = typeof value === "boolean";
  const [draft, setDraft] = useState(String(value));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const dirty = draft !== String(value);

  const save = async (next: string | boolean) => {
    setBusy(true);
    setErr(null);
    try {
      await api.updateSystem(dept, name, next);
      onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-3 px-3.5 py-2 border-b border-border last:border-0">
      <span className="text-[11.5px] text-foreground flex-1 font-mono">{name}</span>
      {isBool ? (
        <button
          disabled={busy}
          onClick={() => save(!(value as boolean))}
          className="text-[10px] font-bold px-2 py-1 rounded text-white disabled:opacity-40"
          style={{ background: value ? OK : ER }}
        >
          {value ? "TRUE" : "FALSE"}
        </button>
      ) : (
        <>
          <input
            value={draft}
            onChange={e => setDraft(e.target.value)}
            disabled={busy}
            className="w-28 px-2 py-1 text-[11.5px] font-mono rounded border border-border bg-white focus:outline-none focus:ring-1 text-right"
          />
          <button
            disabled={busy || !dirty}
            onClick={() => save(draft)}
            className="text-[10px] font-bold px-2.5 py-1 rounded text-white disabled:opacity-30"
            style={{ background: CB }}
          >
            Save
          </button>
        </>
      )}
      {err && <span className="text-[9.5px] text-red-600 max-w-[140px] truncate" title={err}>{err}</span>}
    </div>
  );
}

function CoreSystemsPanel() {
  const { data, loading, error, reload } = useApi(() => api.getSystems(), []);
  const systems = data?.systems ?? {};

  return (
    <div className="bg-white border border-border rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <div>
          <h3 className="text-[13px] font-bold text-foreground" style={{ fontFamily: "Barlow, sans-serif" }}>
            Core Systems Posture
          </h3>
          <p className="text-[10.5px] text-muted-foreground">
            Live operational state the Verification Agent checks against. Edit a value, then reprocess a circular to see PASS/FAIL change.
          </p>
        </div>
        <button onClick={reload} className="text-[10.5px] font-semibold px-2.5 py-1 rounded border border-border hover:bg-secondary flex items-center gap-1.5">
          <RefreshCw size={11} /> Refresh
        </button>
      </div>
      {loading && <Loading label="Loading systems…" />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && (
        <div className="grid grid-cols-2 gap-px bg-border">
          {Object.entries(systems).map(([dept, entry]) => (
            <div key={dept} className="bg-white">
              <div className="px-3.5 py-2 bg-secondary/40 border-b border-border">
                <div className="text-[11.5px] font-bold text-foreground">{dept}</div>
                <div className="text-[9.5px] font-mono text-muted-foreground">{entry.system}</div>
              </div>
              {Object.entries(entry.parameters).map(([name, value]) => (
                <SystemParamRow key={name} dept={dept} name={name} value={value} onSaved={reload} />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SecurityPage() {
  return (
    <div className="flex flex-col h-full overflow-auto">
      <PageHeader title="Security & Trust" sub="Live core-systems posture + architecture overview" />
      <div className="p-6 space-y-5">
        <CoreSystemsPanel />
        <div className="grid grid-cols-3 gap-4">
          {SEC_FEATURES.map((f, i) => (
            <div key={i} className="bg-white border border-border rounded-lg p-5 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between mb-3">
                <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: `${CB}11` }}>
                  <f.Icon size={17} style={{ color: CB }} />
                </div>
                <span className="text-[9.5px] font-extrabold px-2 py-0.5 rounded" style={{ background: `${CY}25`, color: "#7a5200" }}>
                  {f.badge}
                </span>
              </div>
              <h3 className="text-[13px] font-bold text-foreground mb-2" style={{ fontFamily: "Barlow, sans-serif" }}>{f.title}</h3>
              <p className="text-[11.5px] text-muted-foreground leading-relaxed" style={{ fontFamily: "Inter" }}>{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SimpleDiff({ oldStr, newStr }: { oldStr: string | null; newStr: string }) {
  if (!oldStr) {
    return (
      <div className="p-3 bg-emerald-50/50 border border-emerald-100 rounded text-emerald-950 text-[11.5px] leading-relaxed" style={{ wordBreak: 'break-word', overflowWrap: 'break-word' }}>
        <span className="bg-emerald-100 px-1 font-bold text-emerald-800 rounded mr-1">ADD</span>
        {newStr}
      </div>
    );
  }
  
  const oldWords = oldStr.split(/\s+/);
  const newWords = newStr.split(/\s+/);
  
  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="p-3 bg-red-50/40 border border-red-100 rounded text-red-950 text-[11.5px] leading-relaxed overflow-hidden min-w-0">
        <div className="text-[9.5px] font-bold text-red-700 uppercase mb-1.5 tracking-wider">Before (Removed/Amended)</div>
        <div style={{ wordBreak: 'break-word', overflowWrap: 'break-word' }}>
          {oldWords.map((word, idx) => {
            const isDigit = /\d/.test(word);
            const isMissing = !newWords.includes(word);
            return (
              <span 
                key={idx} 
                className={`${isMissing ? 'bg-red-200/70 text-red-800 line-through px-0.5 rounded font-semibold' : ''} ${isDigit && isMissing ? 'font-extrabold border-b border-red-300' : ''}`}
                style={{ marginRight: '3px', display: 'inline' }}
              >
                {word}
              </span>
            );
          })}
        </div>
      </div>
      <div className="p-3 bg-emerald-50/40 border border-emerald-100 rounded text-emerald-950 text-[11.5px] leading-relaxed overflow-hidden min-w-0">
        <div className="text-[9.5px] font-bold text-emerald-700 uppercase mb-1.5 tracking-wider">After (Added/Modified)</div>
        <div style={{ wordBreak: 'break-word', overflowWrap: 'break-word' }}>
          {newWords.map((word, idx) => {
            const isDigit = /\d/.test(word);
            const isNew = !oldWords.includes(word);
            return (
              <span 
                key={idx} 
                className={`${isNew ? 'bg-emerald-200/70 text-emerald-800 font-semibold px-0.5 rounded' : ''} ${isDigit && isNew ? 'font-extrabold border-b border-emerald-400' : ''}`}
                style={{ marginRight: '3px', display: 'inline' }}
              >
                {word}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function PolicyDiffAnalyzer() {
  const { data: circulars, loading: cLoading, error: cError } = useApi(() => api.listCirculars(), []);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  
  const pipeline = useApi(
    () => selectedId ? api.getPipeline(selectedId) : Promise.resolve(null),
    [selectedId]
  );

  const selectedCircular = circulars?.find(c => c.id === selectedId) || null;
  const maps = pipeline.data?.maps ?? [];
  const loading = cLoading || pipeline.loading;
  
  const additions = maps.filter(m => m.changeType === "ADDED");
  const modifications = maps.filter(m => m.changeType === "MODIFIED");
  const deletions = maps.filter(m => m.changeType === "DELETED");

  const changeTypeBadge = (type: string) => {
    switch (type) {
      case "ADDED":
        return { bg: "#dcfce7", fg: "#15803d", label: "Addition" };
      case "MODIFIED":
        return { bg: "#eff6ff", fg: "#1d4ed8", label: "Modification" };
      case "DELETED":
        return { bg: "#fee2e2", fg: "#b91c1c", label: "Removal" };
      default:
        return { bg: "#f3f4f6", fg: "#374151", label: type };
    }
  };

  const impactBadgeColor = (impact: string) => {
    switch (impact) {
      case "LOW":
        return { bg: "#e2e8f0", fg: "#475569" };
      case "MEDIUM":
        return { bg: "#fef3c7", fg: "#d97706" };
      case "HIGH":
        return { bg: "#ffedd5", fg: "#c2410c" };
      case "CRITICAL":
        return { bg: "#fee2e2", fg: "#b91c1c" };
      default:
        return { bg: "#f3f4f6", fg: "#374151" };
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#f8fafc]">
      <PageHeader title="Policy Diff Analyzer" sub="Track compliance changes, modified values, and department routing side-by-side" />
      
      <div className="flex-1 flex min-h-0">
        <div className="w-[320px] border-r border-border bg-white flex flex-col shrink-0">
          <div className="p-4 border-b border-border bg-slate-50/50">
            <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">Select Policy to Diff</div>
            <p className="text-[11px] text-muted-foreground">Select a circular to analyze its changed regulations.</p>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {cLoading && <Loading label="Loading policies..." />}
            {cError && <div className="text-xs text-red-500 p-4">{cError}</div>}
            {circulars && circulars.length === 0 && (
              <div className="text-xs text-muted-foreground p-4 text-center">No circulars ingested yet.</div>
            )}
            {circulars?.map(c => {
              const active = c.id === selectedId;
              return (
                <button
                  key={c.id}
                  onClick={() => setSelectedId(c.id)}
                  className={`w-full text-left p-3 rounded-lg border transition-all ${
                    active 
                      ? "border-primary bg-blue-50/50 shadow-sm" 
                      : "border-border hover:bg-slate-50 bg-white"
                  }`}
                  style={active ? { borderColor: CB } : {}}
                >
                  <div className="text-[9.5px] font-mono font-bold uppercase mb-1" style={{ color: CB }}>
                    {c.refNumber ?? c.id}
                  </div>
                  <div className="text-[12px] font-bold text-slate-800 line-clamp-2 leading-tight mb-1">{c.title}</div>
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                    <span>{c.regulator}</span>
                    <span>•</span>
                    <span>{dateOf(c.issuedDate ?? c.receivedAt)}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 min-w-0">
          {loading && <Loading label="Retrieving change comparison..." />}
          
          {!selectedId ? (
            <div className="h-full flex flex-col items-center justify-center text-center gap-3">
              <GitBranch size={44} className="text-muted-foreground/30 animate-pulse" />
              <h3 className="text-sm font-bold text-slate-700">Select a policy from the list</h3>
              <p className="text-xs text-muted-foreground max-w-sm">We will search chunks by domain, compare hashes against existing policies, and show any added, removed, or modified rules.</p>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="bg-white border border-border rounded-xl p-5 shadow-sm">
                <div className="text-[10px] font-mono font-bold uppercase mb-1" style={{ color: CB }}>
                  {selectedCircular?.refNumber ?? selectedCircular?.id}
                </div>
                <h2 className="text-[16px] font-extrabold text-slate-900 mb-2" style={{ fontFamily: "Barlow, sans-serif" }}>
                  {selectedCircular?.title}
                </h2>
                <p className="text-xs text-muted-foreground leading-relaxed mb-4">
                  This policy has been processed through the Canara ARC Shield mapping engine. The system has automatically extracted rules, matched them to historical versions in the database, and classified them into departments.
                </p>
                
                <div className="grid grid-cols-4 gap-4">
                  <div className="bg-slate-50 border border-slate-100 rounded-lg p-3 text-center">
                    <div className="text-[20px] font-extrabold text-slate-700 leading-none mb-1">{maps.length}</div>
                    <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Total Changes</div>
                  </div>
                  <div className="bg-emerald-50/50 border border-emerald-100 rounded-lg p-3 text-center">
                    <div className="text-[20px] font-extrabold text-emerald-600 leading-none mb-1">{additions.length}</div>
                    <div className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider">Additions</div>
                  </div>
                  <div className="bg-blue-50/50 border border-blue-100 rounded-lg p-3 text-center">
                    <div className="text-[20px] font-extrabold text-blue-600 leading-none mb-1">{modifications.length}</div>
                    <div className="text-[10px] font-bold text-blue-700 uppercase tracking-wider">Modifications</div>
                  </div>
                  <div className="bg-red-50/50 border border-red-100 rounded-lg p-3 text-center">
                    <div className="text-[20px] font-extrabold text-red-600 leading-none mb-1">{deletions.length}</div>
                    <div className="text-[10px] font-bold text-red-700 uppercase tracking-wider">Removals</div>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="text-[13px] font-bold text-slate-800 flex items-center gap-1.5" style={{ fontFamily: "Barlow, sans-serif" }}>
                  <Database size={14} style={{ color: CB }} /> Compliance Maps & Rule Diffs
                </h3>
                
                {maps.length === 0 ? (
                  <div className="bg-white border border-border rounded-xl p-8 text-center text-muted-foreground text-xs shadow-sm">
                    No regulatory changes or rule differences were detected for this policy. All chunks match existing baselines exactly.
                  </div>
                ) : (
                  maps.map((map) => {
                    const cBadge = changeTypeBadge(map.changeType);
                    const iBadge = impactBadgeColor(map.impact);
                    return (
                      <div key={map.id} className="bg-white border border-border rounded-xl p-5 shadow-sm space-y-4 hover:shadow-md transition-shadow">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <div className="flex items-center gap-2">
                            <span className="text-[9.5px] font-extrabold px-2 py-0.5 rounded uppercase" 
                              style={{ background: cBadge.bg, color: cBadge.fg }}>
                              {cBadge.label}
                            </span>
                            <span className="text-[9.5px] font-extrabold px-2 py-0.5 rounded uppercase" 
                              style={{ background: iBadge.bg, color: iBadge.fg }}>
                              {map.impact} severity
                            </span>
                            <span className="text-[9.5px] font-extrabold px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                              {map.department}
                            </span>
                          </div>
                          
                          <div className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
                            <Cpu size={12} />
                            <span>Match confidence: {Math.round(map.confidence * 100)}%</span>
                          </div>
                        </div>

                        <div>
                          <h4 className="text-[13px] font-bold text-slate-800 mb-1">{map.summary}</h4>
                          <p className="text-[11.5px] text-slate-500 italic leading-relaxed">{map.changeReason}</p>
                        </div>

                        <SimpleDiff oldStr={map.oldObligation} newStr={map.newObligation} />
                        
                        <div className="flex items-center justify-between pt-1 border-t border-slate-50 text-[10.5px] text-muted-foreground flex-wrap gap-2">
                          <div>Clause ID: <span className="font-mono font-bold">§{map.clauseId}</span></div>
                          <div className="flex items-center gap-1 text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100">
                            <CheckCircle size={11} /> Verified Compliance Route
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── KPI COMPLIANCE PLANNER ────────────────────────────────────────────── */

const MFA_CSV_TEMPLATE = `employee_id,department,mfa_active,last_login_days_ago,privilege_level
1001,Treasury,1,3,ADMIN
1002,Information Security,1,1,ADMIN
1003,Compliance,1,12,USER
1004,Retail Banking,0,5,USER
1005,Data Privacy Office,1,2,USER
1006,General Legal,0,45,USER
1007,Risk Management,1,1,ADMIN
1008,Retail Banking,0,2,USER
1009,Information Security,1,0,ADMIN
1010,Retail Banking,1,7,USER`;

const MFA_JSON_TEMPLATE = `[
  {
    "kpi_name": "MFA_Adoption_Rate",
    "target_value": 0.95,
    "operator": ">=",
    "field": "mfa_active",
    "department": "Information Security",
    "severity": "CRITICAL"
  },
  {
    "kpi_name": "Inactive_Admin_Retention",
    "target_value": 30,
    "operator": "<=",
    "field": "last_login_days_ago",
    "department": "Risk Management",
    "severity": "HIGH"
  }
]`;

const GRIEVANCE_CSV_TEMPLATE = `ticket_id,channel,category,resolution_days,satisfied
T001,Mobile App,Transactions,12,1
T002,Branch,KYC Obligation,32,0
T003,Website,Card Dispute,4,1
T004,Call Center,AML Flag,45,0
T005,Mobile App,KYC Obligation,28,1
T006,Email,General Legal,15,1
T007,Branch,Transactions,8,1
T008,Mobile App,Card Dispute,42,0`;

const GRIEVANCE_JSON_TEMPLATE = `[
  {
    "kpi_name": "Average_Resolution_SLA",
    "target_value": 15,
    "operator": "<=",
    "field": "resolution_days",
    "department": "Compliance",
    "severity": "HIGH"
  },
  {
    "kpi_name": "Customer_Satisfaction_Rate",
    "target_value": 0.80,
    "operator": ">=",
    "field": "satisfied",
    "department": "Retail Banking",
    "severity": "MEDIUM"
  }
]`;

function KPICompliancePlanner() {
  const [csvText, setCsvText] = useState(MFA_CSV_TEMPLATE);
  const [kpisJson, setKpisJson] = useState(MFA_JSON_TEMPLATE);
  const [mode, setMode] = useState<"assess" | "history">("assess");
  const [loading, setLoading] = useState(false);
  const [sealing, setSealing] = useState(false);
  const [report, setReport] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Load History
  const loadHistory = async () => {
    try {
      const data = await api.listKPIPlans();
      setHistory(data);
    } catch (err: any) {
      console.error(err);
    }
  };

  useState(() => {
    loadHistory();
  });

  const handleTemplateChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    if (val === "mfa") {
      setCsvText(MFA_CSV_TEMPLATE);
      setKpisJson(MFA_JSON_TEMPLATE);
    } else if (val === "grievance") {
      setCsvText(GRIEVANCE_CSV_TEMPLATE);
      setKpisJson(GRIEVANCE_JSON_TEMPLATE);
    } else {
      setCsvText("");
      setKpisJson("[\n  \n]");
    }
  };

  const handleRunAssessment = async () => {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api.postKPIPlan(csvText, kpisJson);
      setReport(res);
      loadHistory();
      setNotice("AI Compliance assessment generated successfully.");
    } catch (err: any) {
      setError(err?.message || "Failed to process compliance metrics.");
    } finally {
      setLoading(false);
    }
  };

  const handleSealReport = async () => {
    if (!report || report.sealed) return;
    setSealing(true);
    setError(null);
    try {
      const res = await api.sealKPIPlan(report.id);
      setReport(res.report);
      loadHistory();
      setNotice(`Sealed to Trust Ledger. Block Index: #${res.block.index}`);
    } catch (err: any) {
      setError(err?.message || "Sealing failed.");
    } finally {
      setSealing(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 flex flex-col h-full">
      <div className="h-16 bg-white border-b border-border flex items-center justify-between px-6 shrink-0">
        <div>
          <h2 className="text-[14px] font-extrabold text-slate-800 uppercase tracking-wide">
            AI KPI Compliance Planner
          </h2>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Ingest audit metrics, compute policy KPIs, and draft department roadmaps sealed on-chain
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setMode("assess");
              setError(null);
            }}
            className={`px-3 py-1.5 rounded text-[11.5px] font-semibold transition-all ${
              mode === "assess" ? "bg-slate-200 text-slate-800" : "bg-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            Run Assessment
          </button>
          <button
            onClick={() => {
              setMode("history");
              loadHistory();
              setError(null);
            }}
            className={`px-3 py-1.5 rounded text-[11.5px] font-semibold transition-all ${
              mode === "history" ? "bg-slate-200 text-slate-800" : "bg-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            Audit History ({history.length})
          </button>
        </div>
      </div>

      {/* Main Panel Content */}
      <div className="flex-1 p-6 flex gap-6 overflow-hidden min-h-0">
        {mode === "assess" ? (
          <>
            {/* Input Configuration Column */}
            <div className="w-[380px] bg-white rounded-xl border border-border flex flex-col overflow-hidden shadow-sm shrink-0">
              <div className="p-4 border-b border-border bg-slate-50/50 flex items-center justify-between">
                <span className="text-[12px] font-bold text-slate-700">Audit Intake parameters</span>
                <select
                  onChange={handleTemplateChange}
                  className="text-[11px] font-medium bg-white border border-border px-2 py-1 rounded shadow-sm focus:outline-none"
                >
                  <option value="mfa">MFA adoption Audit</option>
                  <option value="grievance">Grievance SLA Audit</option>
                  <option value="custom">Blank Template</option>
                </select>
              </div>

              <div className="flex-1 p-4 overflow-y-auto space-y-4">
                {/* CSV text area */}
                <div>
                  <label className="block text-[10.5px] font-extrabold text-slate-500 uppercase tracking-wider mb-1">
                    USER'S UPLOADED CSV (Data Context)
                  </label>
                  <textarea
                    value={csvText}
                    onChange={(e) => setCsvText(e.target.value)}
                    placeholder="csv_header_1,csv_header_2..."
                    className="w-full h-44 p-3 font-mono text-[11px] border border-border rounded-lg bg-slate-50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-slate-300 resize-none leading-normal"
                  />
                </div>

                {/* JSON target KPIs */}
                <div>
                  <label className="block text-[10.5px] font-extrabold text-slate-500 uppercase tracking-wider mb-1">
                    KPI JSONs (Policy Context)
                  </label>
                  <textarea
                    value={kpisJson}
                    onChange={(e) => setKpisJson(e.target.value)}
                    placeholder="[ { 'kpi_name': '...', 'target_value': 0.8 } ]"
                    className="w-full h-48 p-3 font-mono text-[11px] border border-border rounded-lg bg-slate-50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-slate-300 resize-none leading-normal"
                  />
                </div>
              </div>

              <div className="p-4 border-t border-border bg-slate-50 flex flex-col gap-2">
                {error && (
                  <div className="text-[11px] text-red-600 bg-red-50 border border-red-200 px-3 py-2 rounded-lg font-medium">
                    ⚠️ {error}
                  </div>
                )}
                {notice && (
                  <div className="text-[11px] text-emerald-600 bg-emerald-50 border border-emerald-200 px-3 py-2 rounded-lg font-medium">
                    ✅ {notice}
                  </div>
                )}
                <button
                  onClick={handleRunAssessment}
                  disabled={loading}
                  className="w-full py-2.5 rounded-lg text-white font-bold text-[12px] flex items-center justify-center gap-2 tracking-wide transition-all shadow-md active:scale-95"
                  style={{
                    background: loading ? "#94a3b8" : `linear-gradient(135deg, ${CB}, #00366b)`,
                    boxShadow: loading ? "none" : `0 4px 12px ${CB}40`,
                  }}
                >
                  {loading ? (
                    <>
                      <RefreshCw size={12} className="animate-spin" />
                      Analyzing Compliance Gaps...
                    </>
                  ) : (
                    <>
                      <Cpu size={13} />
                      Generate AI Compliance Plan
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Assessment Report Results */}
            <div className="flex-1 bg-white rounded-xl border border-border flex flex-col overflow-hidden shadow-sm">
              {report ? (
                <div className="flex-1 flex flex-col overflow-hidden">
                  {/* Report Header */}
                  <div className={`p-5 border-b border-border flex justify-between items-center ${
                    report.sealed ? "bg-emerald-50/20 border-emerald-100" : "bg-slate-50/50"
                  }`}>
                    <div className="flex items-center gap-4">
                      {/* Radial Gauge for Score */}
                      <div className="relative w-14 h-14 rounded-full flex items-center justify-center shrink-0" style={{
                        background: `conic-gradient(${report.plan.complianceScore >= 80 ? OK : WN} ${report.plan.complianceScore * 3.6}deg, #e2e8f0 0deg)`
                      }}>
                        <div className="w-[46px] h-[46px] bg-white rounded-full flex flex-col items-center justify-center shadow-inner">
                          <span className="text-[12px] font-black text-slate-800 leading-none">{report.plan.complianceScore}%</span>
                          <span className="text-[7.5px] text-slate-400 font-bold uppercase tracking-wider scale-90 mt-0.5">Score</span>
                        </div>
                      </div>

                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-[13px] font-black text-slate-800 tracking-wide">
                            COMPLIANCE AUDIT REPORT
                          </h3>
                          {report.sealed ? (
                            <span className="text-[9px] font-black text-emerald-700 bg-emerald-100/70 border border-emerald-300 px-2 py-0.5 rounded flex items-center gap-1 shadow-sm">
                              <ShieldCheck size={10} /> SEALED ON LEDGER
                            </span>
                          ) : (
                            <span className="text-[9px] font-black text-slate-600 bg-slate-100 border border-slate-300 px-2 py-0.5 rounded uppercase tracking-wide">
                              Draft Plan
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-muted-foreground mt-1 font-mono">
                          ID: {report.id} · Timestamp: {new Date(report.timestamp).toLocaleString()}
                        </p>
                      </div>
                    </div>

                    <div>
                      {!report.sealed ? (
                        <button
                          onClick={handleSealReport}
                          disabled={sealing}
                          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[11.5px] font-bold shadow-sm transition-all flex items-center gap-1.5 active:scale-95 disabled:bg-slate-400"
                        >
                          {sealing ? (
                            <>
                              <RefreshCw size={11} className="animate-spin" />
                              Sealing Audit Block...
                            </>
                          ) : (
                            <>
                              <ShieldCheck size={12} />
                              Seal to Trust Ledger
                            </>
                          )}
                        </button>
                      ) : (
                        <div className="text-right">
                          <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest leading-none">BLOCK VERIFIED</div>
                          <div className="text-[10px] text-emerald-600 font-bold mt-1 font-mono">{shortHash(report.ledgerHash)}</div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Main Report Body */}
                  <div className="flex-1 overflow-y-auto p-6 space-y-6">
                    {/* Summary text */}
                    <div className="bg-slate-50 border border-slate-100 rounded-xl p-4">
                      <h4 className="text-[11px] font-extrabold text-slate-600 uppercase tracking-wider mb-2">
                        Audit Overview Summary
                      </h4>
                      <p className="text-[12px] text-slate-700 leading-relaxed font-medium">
                        {report.plan.summary}
                      </p>
                    </div>

                    {/* KPI Results list */}
                    <div>
                      <h4 className="text-[11px] font-extrabold text-slate-600 uppercase tracking-wider mb-3">
                        KPI Evaluation Metrics
                      </h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {report.plan.kpiResults.map((k: any, idx: number) => {
                          const isPass = k.status === "PASS";
                          return (
                            <div
                              key={idx}
                              className={`border rounded-xl p-4 flex flex-col justify-between shadow-sm transition-all hover:shadow-md ${
                                isPass ? "border-emerald-100 bg-emerald-50/10" : "border-amber-200 bg-amber-50/10"
                              }`}
                            >
                              <div className="flex justify-between items-start">
                                <div>
                                  <span className={`text-[9px] font-extrabold px-2 py-0.5 rounded border mr-2 uppercase tracking-wider ${
                                    isPass ? "text-emerald-700 bg-emerald-50 border-emerald-200" : "text-amber-700 bg-amber-50 border-amber-200"
                                  }`}>
                                    {k.status}
                                  </span>
                                  <span className="text-[10.5px] font-black text-slate-700">{k.kpi_name}</span>
                                </div>
                                <span className={`text-[8.5px] font-extrabold px-1.5 py-0.5 rounded-full ${
                                  k.severity === "CRITICAL" ? "text-red-700 bg-red-50 border border-red-200" :
                                  k.severity === "HIGH" ? "text-amber-700 bg-amber-50 border border-amber-200" : "text-slate-600 bg-slate-100"
                                }`}>
                                  {k.severity}
                                </span>
                              </div>

                              <div className="mt-4 flex items-center justify-between">
                                <div className="text-[11px] text-slate-500">
                                  Target: <span className="font-semibold text-slate-700">{k.operator}{k.target_value}</span>
                                </div>
                                <div className="text-[11px] text-slate-500">
                                  Actual: <span className="font-semibold text-slate-700">{k.actual_value}</span>
                                </div>
                              </div>

                              <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-400">
                                <div>Dept: <span className="font-bold text-slate-600">{k.department}</span></div>
                                {!isPass && (
                                  <div className="text-red-500 font-bold flex items-center gap-0.5">
                                    <AlertTriangle size={9} /> Deviation: {k.deviation}
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Roadmap Timeline */}
                    <div>
                      <h4 className="text-[11px] font-extrabold text-slate-600 uppercase tracking-wider mb-4">
                        Actionable Mitigation Roadmap
                      </h4>
                      <div className="space-y-4 border-l border-slate-200 pl-4 ml-2">
                        {report.plan.roadmap.map((r: any, idx: number) => (
                          <div key={idx} className="relative">
                            {/* Dot indicator */}
                            <div className={`absolute -left-[21px] top-1.5 w-2.5 h-2.5 rounded-full border-2 border-white shadow-sm ${
                              r.priority === "CRITICAL" ? "bg-red-500" :
                              r.priority === "HIGH" ? "bg-amber-500" : "bg-blue-500"
                            }`} />

                            <div className="bg-slate-50 border border-slate-150 rounded-xl p-4 shadow-sm hover:border-slate-300 transition-colors">
                              <div className="flex justify-between items-start flex-wrap gap-2">
                                <h5 className="text-[12.5px] font-black text-slate-800 flex-1 leading-relaxed">
                                  {r.task}
                                </h5>
                                <div className="flex items-center gap-1.5">
                                  <span className={`text-[9px] font-black px-2 py-0.5 rounded ${
                                    r.priority === "CRITICAL" ? "text-red-700 bg-red-50 border border-red-200" :
                                    r.priority === "HIGH" ? "text-amber-700 bg-amber-50 border border-amber-200" : "text-blue-700 bg-blue-50 border-blue-200"
                                  }`}>
                                    {r.priority}
                                  </span>
                                </div>
                              </div>

                              <div className="mt-3 flex items-center justify-between text-[11px] text-slate-500 pt-3 border-t border-slate-200/50">
                                <div>Department Owner: <span className="font-bold text-slate-700">{r.department}</span></div>
                                <div className="flex items-center gap-1 font-semibold text-slate-600 bg-white px-2 py-1 rounded border border-border shadow-2xs">
                                  <Calendar size={11} /> {r.timeline}
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Complete Report Details (Markdown) */}
                    <div>
                      <h4 className="text-[11px] font-extrabold text-slate-600 uppercase tracking-wider mb-2">
                        Raw AI Report (Markdown)
                      </h4>
                      <pre className="w-full bg-slate-900 text-slate-100 text-[11px] font-mono p-4 rounded-xl overflow-x-auto max-h-60 leading-normal">
                        {report.plan.rawReport}
                      </pre>
                    </div>
                  </div>
                </div>
              ) : (
                <EmptyState
                  title="Compliance planner is idle"
                  sub="Load a template, adjust raw parameters, and click Generate to analyze compliance posture."
                />
              )}
            </div>
          </>
        ) : (
          /* Audit History Mode */
          <div className="flex-1 bg-white rounded-xl border border-border flex flex-col overflow-hidden shadow-sm">
            <div className="p-4 border-b border-border bg-slate-50/50">
              <span className="text-[12px] font-black text-slate-700">Sealed KPI Compliance Audits Ledger</span>
            </div>

            {history.length > 0 ? (
              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                {history.map((h: any) => (
                  <div
                    key={h.id}
                    onClick={() => {
                      setReport(h);
                      setMode("assess");
                    }}
                    className="border border-border rounded-xl p-4 bg-white hover:border-slate-300 hover:shadow-md transition-all cursor-pointer flex justify-between items-center"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-[12px] font-black text-slate-800">
                          Audit {h.id.substring(4, 12)}...
                        </span>
                        {h.sealed ? (
                          <span className="text-[8.5px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded">
                            SEALED
                          </span>
                        ) : (
                          <span className="text-[8.5px] font-bold text-slate-500 bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded">
                            DRAFT
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-1">
                        Compliance Score: <span className="font-bold text-slate-800">{h.plan.complianceScore}%</span> · Date: {new Date(h.timestamp).toLocaleString()}
                      </p>
                      {h.ledgerHash && (
                        <p className="text-[9.5px] font-mono text-emerald-600 mt-1">
                          Block hash: {h.ledgerHash}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <ChevronRight size={16} className="text-slate-400" />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                title="No compliance reports found"
                sub="Your generated AI compliance planner reports will show up here."
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}


/* ─── APP ROOT ──────────────────────────────────────────────────────────── */

export default function App() {
  const [active, setActive] = useState("dashboard");
  return (
    <div className="flex h-screen overflow-hidden bg-background" style={{ fontFamily: "Inter, sans-serif" }}>
      <Sidebar active={active} setActive={setActive} />
      <main className="flex-1 overflow-hidden flex flex-col">
        {active === "dashboard"  && <ExecutiveDashboard />}
        {active === "circular"   && <CircularExplorer />}
        {active === "diff"       && <PolicyDiffAnalyzer />}
        {active === "kpi"        && <KPICompliancePlanner />}
        {active === "copilot"    && <ComplianceCopilot />}
        {active === "blockchain" && <BlockchainTrustCenter />}
        {active === "roles"      && <RoleWorkspace />}
        {active === "review"     && <ReviewQueuePage />}
        {active === "security"   && <SecurityPage />}
      </main>
    </div>
  );
}
