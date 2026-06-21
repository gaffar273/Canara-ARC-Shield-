import { get, post, upload } from "./client.js";
import type {
  Circular,
  PipelineRecord,
  ReferenceGraph,
  DashboardSummary,
  RoleWorkspace,
  LedgerBlock,
  ChainVerification,
  CopilotAnswer,
  Role,
} from "./types.js";

export const listCirculars = () => get<Circular[]>("/circulars");

export const getCircular = (id: string) => get<Circular>(`/circulars/${id}`);

export const getPipeline = (id: string) => get<PipelineRecord>(`/circulars/${id}/pipeline`);

export const getReferences = (id: string) => get<ReferenceGraph>(`/circulars/${id}/references`);

export const getDashboardSummary = () => get<DashboardSummary>("/dashboard/summary");

export const getRoleWorkspace = (role: Role) =>
  get<RoleWorkspace>(`/dashboard/role/${role}`, role);

export const getChain = () => get<LedgerBlock[]>("/ledger/chain");

export const verifyChain = () => get<ChainVerification>("/ledger/verify");

export const askCopilot = (query: string) => post<CopilotAnswer>("/copilot/ask", { query });

export async function uploadCircular(file: File): Promise<Circular> {
  const form = new FormData();
  form.append("file", file);
  return upload<Circular>("/circulars", form);
}

export const processCircular = (id: string) =>
  post<{ circularId: string; started: boolean }>(`/circulars/${id}/process`, {});
