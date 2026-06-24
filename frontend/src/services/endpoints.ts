import { get, post, del, put, upload } from "./client.js";
import type {
  Circular,
  ComplianceMap,
  PipelineRecord,
  ReferenceGraph,
  DashboardSummary,
  RoleWorkspace,
  ReviewQueue,
  LedgerBlock,
  ChainVerification,
  LedgerNetwork,
  LedgerAgent,
  CopilotAnswer,
  SystemsState,
  ParameterValue,
  CircularStatus,
  Role,
} from "./types.js";

export const listCirculars = () => get<Circular[]>("/circulars");

export const getCircular = (id: string) => get<Circular>(`/circulars/${id}`);

export const getPipeline = (id: string) => get<PipelineRecord>(`/circulars/${id}/pipeline`);

export const getReferences = (id: string) => get<ReferenceGraph>(`/circulars/${id}/references`);

export const getDashboardSummary = () => get<DashboardSummary>("/dashboard/summary");

export const getRoleWorkspace = (role: Role) =>
  get<RoleWorkspace>(`/dashboard/role/${role}`, role);

export const getReviewQueue = () => get<ReviewQueue>("/dashboard/review-queue");

export const getCircularStatus = () =>
  get<Record<string, CircularStatus>>("/dashboard/circular-status");

export const getChain = () => get<LedgerBlock[]>("/ledger/chain");

export const verifyChain = () => get<ChainVerification>("/ledger/verify");

export const getLedgerNetwork = () => get<LedgerNetwork>("/ledger/network");

export const getLedgerAgents = () => get<LedgerAgent[]>("/ledger/agents");

export const askCopilot = (query: string) => post<CopilotAnswer>("/copilot/ask", { query });

export async function uploadCircular(file: File): Promise<Circular> {
  const form = new FormData();
  form.append("file", file);
  return upload<Circular>("/circulars", form);
}

export const processCircular = (id: string) =>
  post<{ circularId: string; started: boolean }>(`/circulars/${id}/process`, {});

export const deleteCircular = (id: string) =>
  del<{ circularId: string; deleted: boolean }>(`/circulars/${id}`, "compliance");

export interface DecisionInput {
  status: "APPROVED" | "REJECTED" | "REASSIGNED";
  note: string;
  reassignedTo?: Role | null;
}

export const decideMap = (circularId: string, mapId: string, input: DecisionInput) =>
  post<ComplianceMap>(`/circulars/${circularId}/maps/${mapId}/decision`, input, "compliance");

export const getSystems = () => get<SystemsState>("/systems");

export const updateSystem = (
  department: string,
  parameter: string,
  value: string | number | boolean,
) =>
  put<ParameterValue>(
    `/systems/${encodeURIComponent(department)}/${encodeURIComponent(parameter)}`,
    { value },
    "it",
  );
