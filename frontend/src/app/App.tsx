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
  ResponsiveContainer,
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
 *  MAPPED = verified satisfied, FLAGGED = Node 3 found a gap, PENDING = mapped
 *  but work not yet verified done / awaiting review, UNMAPPED = no MAP yet. */
type ClauseStatus = "MAPPED" | "PENDING" | "FLAGGED" | "UNMAPPED";

const CLAUSE_STATUS_STYLE: Record<ClauseStatus, { bg: string; fg: string }> = {
  MAPPED:   { bg: "#dcfce7", fg: "#15803d" },
  PENDING:  { bg: "#fef9c3", fg: "#854d0e" },
  FLAGGED:  { bg: "#fee2e2", fg: "#b91c1c" },
  UNMAPPED: { bg: "#f1f5f9", fg: "#64748b" },
};

function clauseStatus(
  clauseId: string,
  maps: { id: string; clauseId: string }[],
  verifications: { mapId: string; status: string }[],
): ClauseStatus {
  const map = maps.find(m => m.clauseId === clauseId);
  if (!map) return "UNMAPPED";
  const v = verifications.find(x => x.mapId === map.id);
  if (!v) return "PENDING";
  if (v.status === "PASS") return "MAPPED";
  if (v.status === "FAIL") return "FLAGGED";
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

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex items-start justify-between gap-4">
        <div>
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
                return (
                  <div key={v.id} className="flex items-center gap-3 px-3.5 py-2.5 rounded-md border border-border bg-white">
                    <span className="text-[9px] font-extrabold px-1.5 py-0.5 rounded shrink-0 text-white" style={{ background: verdictColor(v.status) }}>{v.status}</span>
                    <span className="text-[12.5px] flex-1" style={{ fontFamily: "Inter" }}>{m?.summary ?? v.mapId}</span>
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0" style={agentBadgeStyle(v.verifiedBy)}>{agentLabel(v.verifiedBy)}</span>
                    <span className="font-mono text-[10px] text-muted-foreground shrink-0">{Math.round(v.score * 100)}%</span>
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

/* ─── APP ROOT ──────────────────────────────────────────────────────────── */

export default function App() {
  const [active, setActive] = useState("dashboard");
  return (
    <div className="flex h-screen overflow-hidden bg-background" style={{ fontFamily: "Inter, sans-serif" }}>
      <Sidebar active={active} setActive={setActive} />
      <main className="flex-1 overflow-hidden flex flex-col">
        {active === "dashboard"  && <ExecutiveDashboard />}
        {active === "circular"   && <CircularExplorer />}
        {active === "copilot"    && <ComplianceCopilot />}
        {active === "blockchain" && <BlockchainTrustCenter />}
        {active === "roles"      && <RoleWorkspace />}
        {active === "review"     && <ReviewQueuePage />}
        {active === "security"   && <SecurityPage />}
      </main>
    </div>
  );
}
