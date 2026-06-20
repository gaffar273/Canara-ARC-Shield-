import { config } from "../../config/index.js";
import type { LedgerBackend } from "./types.js";
import { HashChainBackend } from "./hashChain.js";
import { FabricBackend } from "./fabric.js";

/**
 * Selects the ledger backend. Fabric when FABRIC_ENABLED is set, otherwise the
 * local hash-chain. Callers depend only on LedgerBackend, so neither the
 * service layer nor the routes change when the backend is swapped.
 */
function create(): LedgerBackend {
  if (config.fabric.enabled) {
    console.log("[ledger] using Hyperledger Fabric backend");
    return new FabricBackend();
  }
  console.log("[ledger] using local hash-chain backend");
  return new HashChainBackend();
}

export const ledgerBackend: LedgerBackend = create();
export type { LedgerBackend, VerifyResult } from "./types.js";
