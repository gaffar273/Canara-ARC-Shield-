import { promises as fs } from "node:fs";
import { connect, signers, type Contract, type Gateway } from "@hyperledger/fabric-gateway";
import * as grpc from "@grpc/grpc-js";
import { credentials } from "@grpc/grpc-js";
import { createPrivateKey } from "node:crypto";
import path from "node:path";
import { config } from "../../config/index.js";
import type { LedgerBlock } from "../../types/domain.js";
import { Mutex } from "../../utils/mutex.js";
import { fail } from "../../utils/errors.js";
import type { LedgerBackend, VerifyResult } from "./types.js";

const utf8 = new TextDecoder();

async function firstFile(dir: string): Promise<string> {
  const entries = await fs.readdir(dir);
  const file = entries[0];
  if (!file) throw fail("INTERNAL", `No file found in ${dir}`);
  return path.join(dir, file);
}

/**
 * Hyperledger Fabric ledger backend. Appends are submitted transactions
 * (ordered + committed by the network); reads are evaluations. A mutex
 * serializes submits so the head cannot be raced, matching the hash-chain
 * backend's single-writer guarantee.
 */
export class FabricBackend implements LedgerBackend {
  readonly kind = "fabric" as const;
  private readonly lock = new Mutex();
  private gateway: Gateway | null = null;
  private client: grpc.Client | null = null;
  private contract: Contract | null = null;

  private async getContract(): Promise<Contract> {
    if (this.contract) return this.contract;

    const f = config.fabric;
    const tlsCert = await fs.readFile(f.tlsCertPath);
    const certPem = await fs.readFile(await firstFile(f.certDir));
    const keyPem = await fs.readFile(await firstFile(f.keyDir));

    this.client = new grpc.Client(
      f.peerEndpoint,
      credentials.createSsl(tlsCert),
      { "grpc.ssl_target_name_override": f.peerHostAlias },
    );

    this.gateway = connect({
      client: this.client,
      identity: { mspId: f.mspId, credentials: certPem },
      signer: signers.newPrivateKeySigner(createPrivateKey(keyPem)),
      evaluateOptions: () => ({ deadline: Date.now() + config.agents.timeoutMs }),
      submitOptions: () => ({ deadline: Date.now() + config.agents.timeoutMs }),
    });

    const network = this.gateway.getNetwork(f.channel);
    this.contract = network.getContract(f.chaincode);
    return this.contract;
  }

  async append(
    kind: LedgerBlock["kind"],
    refId: string,
    payloadHash: string,
  ): Promise<LedgerBlock> {
    return this.lock.run(async () => {
      const contract = await this.getContract();
      const bytes = await contract.submitTransaction(
        "RecordBlock",
        kind,
        refId,
        payloadHash,
      );
      return JSON.parse(utf8.decode(bytes)) as LedgerBlock;
    });
  }

  async all(): Promise<LedgerBlock[]> {
    const contract = await this.getContract();
    const bytes = await contract.evaluateTransaction("GetChain");
    return JSON.parse(utf8.decode(bytes)) as LedgerBlock[];
  }

  async forRef(refId: string): Promise<LedgerBlock[]> {
    const contract = await this.getContract();
    const bytes = await contract.evaluateTransaction("GetByRef", refId);
    return JSON.parse(utf8.decode(bytes)) as LedgerBlock[];
  }

  async verifyChain(): Promise<VerifyResult> {
    const contract = await this.getContract();
    const bytes = await contract.evaluateTransaction("VerifyChain");
    const raw = JSON.parse(utf8.decode(bytes)) as { valid: boolean; brokenAt: number };
    // Chaincode uses -1 for "no break"; normalize to null to match the
    // hash-chain backend's VerifyResult shape.
    return { valid: raw.valid, brokenAt: raw.brokenAt < 0 ? null : raw.brokenAt };
  }

  close(): void {
    this.gateway?.close();
    this.client?.close();
    this.gateway = null;
    this.client = null;
    this.contract = null;
  }
}
