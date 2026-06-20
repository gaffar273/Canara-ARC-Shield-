import type { LedgerBlock } from "../../types/domain.js";

export interface VerifyResult {
  valid: boolean;
  brokenAt: number | null;
}

/**
 * One ledger seam, two implementations: the local hash-chain and Hyperledger
 * Fabric. The service layer depends only on this interface, so the backend is
 * selected by config without any caller change (no duplicate APIs).
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
}
