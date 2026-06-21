import { useState, useRef } from "react";
import {
  LayoutDashboard, Search, MessageSquare, ShieldCheck, Users,
  Lock, Bell, Settings, TrendingUp, TrendingDown, AlertTriangle,
  CheckCircle, FileText, Hash, Database, Send, RefreshCw,
  Download, ArrowRight, AlertCircle, Award, Zap, Building2,
  Globe, Fingerprint, GitBranch, ChevronRight, Eye, Cpu,
  Plus, Calendar, Filter, Upload, Link2, XCircle,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from "recharts";
import { useApi } from "../hooks/useApi.js";
import * as api from "../services/endpoints.js";
import { uploadCircular, processCircular } from "../services/endpoints.js";
import { ApiError } from "../services/client.js";
import { Loading, ErrorState, EmptyState, Placeholder } from "./components/States.js";
import type {
  Circular, PipelineStage, SectionScore, LedgerBlock, LedgerKind,
  Citation, Role,
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
  { id: "security",  icon: Lock,            label: "Security & Trust" },
];

/* ─── SHARED HELPERS ───────────────────────────────────────────────────── */

const SC = { compliant: OK, warning: WN, violation: ER };

function shortHash(h: string): string {
  if (!h) return "—";
  const body = h.startsWith("0x") ? h.slice(2) : h;
  return `0x${body.slice(0, 6)}…${body.slice(-4)}`;
}

function dateOf(iso: string | null): string {
  if (!iso) return "—";
  return iso.slice(0, 10);
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
          <div className="text-[9px] text-muted-foreground mt-0.5 tracking-widest uppercase">Canara Bank · v2.4.1</div>
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
          <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-extrabold text-white shrink-0" style={{ background: CB }}>
            RK
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[12px] font-semibold text-foreground truncate">Rajesh Kumar</div>
            <div className="text-[10px] text-muted-foreground">Compliance Officer</div>
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
  const { data, loading, error, reload } = useApi(() => api.getDashboardSummary(), []);

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
              <h3 className="text-sm font-bold mb-3" style={{ fontFamily: "Barlow, sans-serif", color: "#0a1628" }}>
                Audit Status Timeline
              </h3>
              <Placeholder title="Audit timeline coming soon" sub="Scheduled-audit tracking isn’t served by this service yet." />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ─── CIRCULAR EXPLORER ────────────────────────────────────────────────── */

function CircularDetail({ circular }: { circular: Circular }) {
  const pipeline = useApi(() => api.getPipeline(circular.id), [circular.id]);
  const refs = useApi(() => api.getReferences(circular.id), [circular.id]);
  const clauses = pipeline.data?.intelligence?.clauses ?? [];
  const similar = pipeline.data?.intelligence?.similarTo ?? null;

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
          {clauses.length > 0 && <span className="text-[10px] text-muted-foreground">{clauses.length} clauses</span>}
        </div>
        {pipeline.loading ? <Loading />
          : pipeline.error ? <ErrorState message={pipeline.error} onRetry={pipeline.reload} />
          : clauses.length === 0 ? <EmptyState title="No clauses extracted yet" sub="Clause extraction runs in Node 1 — appears once it’s connected." />
          : (
            <div className="space-y-1.5">
              {clauses.map(clause => (
                <div key={clause.id} className="flex items-center gap-3 px-3.5 py-2.5 rounded-md border border-border bg-white">
                  <span className="font-mono text-[10.5px] font-bold w-10 shrink-0" style={{ color: CB }}>§{clause.id}</span>
                  <span className="text-[12.5px] flex-1" style={{ fontFamily: "Inter" }}>{clause.title}</span>
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: `${CB}10`, color: CB }}>{clause.section}</span>
                  {clause.obligationBearing && (
                    <span className="text-[9px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">obligation</span>
                  )}
                </div>
              ))}
            </div>
          )}
      </div>
    </div>
  );
}

function CircularExplorer() {
  const { data, loading, error, reload } = useApi(() => api.listCirculars(), []);
  const [query, setQuery] = useState("");
  const [reg, setReg]     = useState<string | null>(null);
  const [sel, setSel]     = useState<Circular | null>(null);
  const [busy, setBusy]   = useState(false);
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
      setSel(created);
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
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
              const status = circularStatus(c.stage);
              return (
                <button
                  key={c.id}
                  onClick={() => setSel(c)}
                  className={`w-full text-left px-4 py-3.5 border-b border-border transition-colors hover:bg-secondary/50 ${
                    sel?.id === c.id ? "bg-secondary" : ""
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <span className="text-[10px] font-mono font-bold" style={{ color: CB }}>{c.refNumber ?? c.id}</span>
                    <span className="text-[8.5px] font-extrabold px-1.5 py-0.5 rounded-sm uppercase tracking-wide text-white shrink-0"
                      style={{ background: STATUS_COLOR[status] }}>
                      {STATUS_LABEL[status]}
                    </span>
                  </div>
                  <div className="text-[12px] font-semibold text-foreground leading-snug mb-2" style={{ fontFamily: "Inter" }}>{c.title}</div>
                  <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                    {c.regulator && <span className="font-bold" style={{ color: CB }}>{c.regulator}</span>}
                    <span>{dateOf(c.issuedDate ?? c.receivedAt)}</span>
                    <span>{c.references.length} refs</span>
                  </div>
                </button>
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
                  {m.role === "ai" ? "AI" : "RK"}
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

const KIND_LABEL: Record<LedgerKind, string> = {
  CIRCULAR_RECEIVED: "Circular Received",
  MAP_GENERATED: "MAP Generated",
  VERIFICATION_EXECUTED: "Verification Executed",
  EVIDENCE_COLLECTED: "Evidence Collected",
  AUDIT_RECEIPT: "Audit Receipt Issued",
};

function BlockchainTrustCenter() {
  const chain = useApi(() => api.getChain(), []);
  const verify = useApi(() => api.verifyChain(), []);
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
                  <h3 className="text-[11px] font-bold mb-3" style={{ fontFamily: "Barlow", color: "#0a1628" }}>X.509 Signatures</h3>
                  <Placeholder title="Signers coming soon" sub="Signer attestations aren’t exposed by the ledger API yet." />
                </div>
                <div className="bg-white border border-border rounded-lg p-4">
                  <h3 className="text-[11px] font-bold mb-3" style={{ fontFamily: "Barlow", color: "#0a1628" }}>Fabric Network</h3>
                  <Placeholder title="Network view coming soon" sub="Peer/org topology isn’t served by this endpoint." />
                </div>
              </div>
            </div>

            <div className="bg-white border border-border rounded-lg p-5">
              <h3 className="text-sm font-bold mb-3" style={{ fontFamily: "Barlow, sans-serif", color: "#0a1628" }}>Recent Fabric Transactions</h3>
              <Placeholder title="Transaction table coming soon" sub="Per-channel Fabric transactions aren’t exposed by this service yet." />
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
                      <span className="flex-1 text-[12px] text-foreground">{m.action}</span>
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

/* ─── SECURITY PAGE ─────────────────────────────────────────────────────── */

const SEC_FEATURES = [
  { Icon: Database,    title: "Zero Data Retention",   badge: "Privacy-First", desc: "No customer PII is stored or processed. Only cryptographic hashes of compliance evidence are written to the immutable ledger." },
  { Icon: Building2,   title: "Multi-Tenancy",         badge: "Isolated",      desc: "Tenant isolation via separate ledger channels. Each bank's data is cryptographically separated." },
  { Icon: Fingerprint, title: "RBAC Access Control",   badge: "Zero Trust",    desc: "Role-Based Access Control enforced at every API boundary via the x-role header." },
  { Icon: Hash,        title: "Hash-Only Storage",     badge: "Immutable",     desc: "Documents are never stored on-chain. Only SHA-256 hashes are recorded in the tamper-evident ledger." },
  { Icon: Lock,        title: "End-to-End Encryption", badge: "TLS 1.3",       desc: "All API communications use TLS. Peer communications use mutual TLS." },
  { Icon: Globe,       title: "Regulatory Compliance", badge: "By Design",     desc: "Designed to align with RBI IT Framework and SEBI Cybersecurity guidelines." },
];

function SecurityPage() {
  return (
    <div className="flex flex-col h-full overflow-auto">
      <PageHeader title="Security & Trust" sub="Architecture overview · informational" />
      <div className="p-6 space-y-5">
        <Placeholder title="Informational page" sub="These describe the platform's security design. Live posture metrics aren’t served by this service." />
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
        {active === "security"   && <SecurityPage />}
      </main>
    </div>
  );
}
