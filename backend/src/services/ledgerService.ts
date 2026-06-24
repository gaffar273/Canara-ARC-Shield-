import type { LedgerBlock, PipelineRecord } from "../types/domain.js";
import { ledgerBackend } from "../store/ledger/index.js";
import { config } from "../config/index.js";
import { sha256, sha256Of, shortHash } from "../utils/crypto.js";

export interface ChainOfCustody {
  refId: string;
  events: {
    index: number;
    kind: LedgerBlock["kind"];
    timestamp: string;
    hash: string;
    shortHash: string;
  }[];
}

export interface LedgerNetwork {
  backend: "fabric" | "hash-chain";
  fabric: {
    mspId: string;
    channel: string;
    chaincode: string;
    peerEndpoint: string;
    peerHostAlias: string;
  } | null;
}

/**
 * Trust Layer. Records hashed chain-of-custody events and seals a pipeline with
 * an audit receipt committing to every prior block. Backed by the hash-linked
 * ledger store; a real Hyperledger Fabric chaincode swaps in behind this API.
 */
export const ledgerService = {
  async recordCircularReceived(circularId: string, documentHash: string): Promise<LedgerBlock> {
    return ledgerBackend.append("CIRCULAR_RECEIVED", circularId, documentHash);
  },

  async recordMapGenerated(circularId: string, maps: unknown): Promise<LedgerBlock> {
    return ledgerBackend.append("MAP_GENERATED", circularId, sha256Of(maps));
  },

  async recordVerification(circularId: string, verifications: unknown): Promise<LedgerBlock> {
    return ledgerBackend.append("VERIFICATION_EXECUTED", circularId, sha256Of(verifications));
  },

  async recordEvidence(circularId: string, evidence: unknown): Promise<LedgerBlock> {
    return ledgerBackend.append("EVIDENCE_COLLECTED", circularId, sha256Of(evidence));
  },

  /** Seals a human reviewer's decision on a MAP into the audit chain. */
  async recordHumanDecision(circularId: string, decision: unknown): Promise<LedgerBlock> {
    return ledgerBackend.append("HUMAN_DECISION", circularId, sha256Of(decision));
  },

  /** Seals the pipeline: an audit receipt committing to all of its block hashes. */
  async sealAuditReceipt(record: PipelineRecord): Promise<LedgerBlock> {
    const prior = await ledgerBackend.forRef(record.circularId);
    const commitment = sha256(prior.map((b) => b.hash).join("|"));
    return ledgerBackend.append("AUDIT_RECEIPT", record.circularId, commitment);
  },

  async chainOfCustody(refId: string): Promise<ChainOfCustody> {
    const blocks = await ledgerBackend.forRef(refId);
    return {
      refId,
      events: blocks.map((b) => ({
        index: b.index,
        kind: b.kind,
        timestamp: b.timestamp,
        hash: b.hash,
        shortHash: shortHash(b.hash),
      })),
    };
  },

  async fullChain(): Promise<LedgerBlock[]> {
    return ledgerBackend.all();
  },

  async verifyIntegrity(): Promise<{ valid: boolean; brokenAt: number | null }> {
    return ledgerBackend.verifyChain();
  },

  /** The live trust-layer topology, sourced from the active backend + config. */
  network(): LedgerNetwork {
    const onFabric = ledgerBackend.kind === "fabric";
    return {
      backend: ledgerBackend.kind,
      fabric: onFabric
        ? {
            mspId: config.fabric.mspId,
            channel: config.fabric.channel,
            chaincode: config.fabric.chaincode,
            peerEndpoint: config.fabric.peerEndpoint,
            peerHostAlias: config.fabric.peerHostAlias,
          }
        : null,
    };
  },
};
