export type Role = "compliance" | "it" | "cxo" | "auditor";

export type Regulator = "RBI" | "SEBI" | "IRDAI" | "MCA";

export type RegSection =
  | "KYC"
  | "AML"
  | "Cyber"
  | "Treasury"
  | "Risk"
  | "IT Risk"
  | "Basel"
  | "Other";

export type PipelineStage =
  | "RECEIVED"
  | "CLASSIFYING"
  | "MAPPING"
  | "VERIFYING"
  | "SEALED"
  | "COMPLETE"
  | "FAILED";

export type MapCategory = "technical" | "policy";

export type ChangeType = "ADDED" | "MODIFIED" | "DELETED";

export type Impact = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type VerificationStatus = "PASS" | "FAIL" | "REVIEW";

export type DecisionStatus = "APPROVED" | "REJECTED" | "REASSIGNED";

export interface MapDecision {
  status: DecisionStatus;
  note: string;
  decidedBy: Role;
  decidedAt: string;
  reassignedTo: Role | null;
  ledgerHash: string;
}

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
  refNumber?: string | null;
  references?: string[];
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
  decision: MapDecision | null;
}

export interface VerificationResult {
  id: string;
  mapId: string;
  status: VerificationStatus;
  score: number;
  verifiedBy: MapCategory;
  evidence: { kind: string; ref: string; timestamp: string }[];
}

export interface LedgerBlock {
  index: number;
  timestamp: string;
  kind:
    | "CIRCULAR_RECEIVED"
    | "MAP_GENERATED"
    | "VERIFICATION_EXECUTED"
    | "EVIDENCE_COLLECTED"
    | "AUDIT_RECEIPT"
    | "HUMAN_DECISION";
  refId: string;
  payloadHash: string;
  prevHash: string;
  hash: string;
  /** Fabric identity (MSP id + cert fingerprint) that sealed this block.
   *  Present only on the Fabric backend once identity capture is deployed. */
  submittedBy?: string;
}

/** An on-chain registered agent (Fabric-native identity scoped to block kinds). */
export interface LedgerAgent {
  id: string;
  role: string;
  mspId: string;
  certHash: string;
  allowedKinds: string[];
  registeredAt: string;
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
