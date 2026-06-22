// Mirrors the backend domain (backend/src/types/domain.ts) and service response
// shapes. The backend is the single source of truth; these match it field-for-field.

export type Role = "compliance" | "it" | "cxo" | "auditor";
export type Regulator = "RBI" | "SEBI" | "IRDAI" | "MCA";
export type RegSection =
  | "KYC" | "AML" | "Cyber" | "Treasury" | "Risk" | "IT Risk" | "Basel" | "Other";
export type PipelineStage =
  | "RECEIVED" | "CLASSIFYING" | "MAPPING" | "VERIFYING" | "SEALED" | "COMPLETE" | "FAILED";
export type MapCategory = "technical" | "policy";
export type ChangeType = "ADDED" | "MODIFIED" | "DELETED";
export type Impact = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type VerificationStatus = "PASS" | "FAIL" | "REVIEW";

export interface DocumentMeta {
  filename: string;
  mimeType: string;
  bytes: number;
  pages: number;
  sha256: string;
  storedPath: string;
}

export interface Circular {
  id: string;
  title: string;
  regulator: Regulator | null;
  sections: RegSection[];
  issuedDate: string | null;
  receivedAt: string;
  stage: PipelineStage;
  document: DocumentMeta;
  textLength: number;
  refNumber: string | null;
  references: string[];
}

export interface Clause {
  id: string;
  section: RegSection;
  title: string;
  text: string;
  obligationBearing: boolean;
}

export interface IntelligenceResult {
  circularId: string;
  title: string;
  regulator: Regulator;
  issuedDate: string | null;
  sections: RegSection[];
  similarTo: { circularId: string; similarity: number } | null;
  clauses: Clause[];
}

export interface ComplianceMap {
  id: string;
  circularId: string;
  clauseId: string;
  changeType: ChangeType;
  changeReason: string;
  impact: Impact;
  summary: string;
  oldObligation: string | null;
  newObligation: string;
  department: string;
  owner: Role;
  deadline: string | null;
  category: MapCategory;
  confidence: number;
  needsReview: boolean;
}

export interface VerificationResult {
  id: string;
  mapId: string;
  status: VerificationStatus;
  score: number;
  evidence: { kind: string; ref: string; timestamp: string }[];
}

export interface PipelineRecord {
  circularId: string;
  stage: PipelineStage;
  intelligence: IntelligenceResult | null;
  maps: ComplianceMap[];
  verifications: VerificationResult[];
  auditReceiptHash: string | null;
  updatedAt: string;
  error: string | null;
}

export type LedgerKind =
  | "CIRCULAR_RECEIVED"
  | "MAP_GENERATED"
  | "VERIFICATION_EXECUTED"
  | "EVIDENCE_COLLECTED"
  | "AUDIT_RECEIPT";

export interface LedgerBlock {
  index: number;
  timestamp: string;
  kind: LedgerKind;
  refId: string;
  payloadHash: string;
  prevHash: string;
  hash: string;
}

export interface ChainVerification {
  valid: boolean;
  brokenAt: number | null;
}

export interface ReferenceEdge {
  ref: string;
  circularId: string | null;
}

export interface ReferenceGraph {
  circularId: string;
  refNumber: string | null;
  references: ReferenceEdge[];
  citedBy: { circularId: string; refNumber: string | null }[];
}

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

export interface RoleWorkspace {
  role: Role;
  maps: ComplianceMap[];
  verifications: VerificationResult[];
}

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
