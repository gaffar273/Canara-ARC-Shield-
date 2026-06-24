import type { LedgerBlock, LedgerAgent } from "../../types/domain.js";

export interface VerifyResult {
  valid: boolean;
  brokenAt: number | null;
}

/**
 * One ledger seam, two implementations: the local hash-chain and Hyperledger
 * Fabric. The service layer depends only on this interface, so the backend is
 * selected by config without any caller change (no duplicate APIs).
 *
 * Agent identity/registry is Fabric-native and therefore optional: the
 * hash-chain backend does not implement it (it has no submitter identity).
 */
export interface LedgerBackend {
  readonly kind: "hash-chain" | "fabric";
  append(
    kind: LedgerBlock["kind"],
    refId: string,
    payloadHash: string,
  ): Promise<LedgerBlock>;
  all(): Promise<LedgerBlock[]>;
  forRef(refId: string): Promise<LedgerBlock[]>;
  verifyChain(): Promise<VerifyResult>;
  registerAgent?(id: string, role: string, allowedKinds: string[]): Promise<LedgerAgent>;
  listAgents?(): Promise<LedgerAgent[]>;
}
