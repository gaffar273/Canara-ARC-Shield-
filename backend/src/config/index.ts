import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dir, "..", "..");

// Load .env into process.env if present. Absent file is fine: in production the
// platform injects env directly.
try {
  process.loadEnvFile(path.join(root, ".env"));
} catch {
  // no .env file; rely on the ambient environment
}

function num(value: string | undefined, fallback: number): number {
  const n = value === undefined ? NaN : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  env: process.env.NODE_ENV ?? "development",
  port: num(process.env.PORT, 4000),

  paths: {
    root,
    uploads: path.join(root, "uploads"),
    data: path.join(root, "data"),
    documents: path.join(root, "data", "documents"),
    ledger: path.join(root, "data", "ledger.jsonl"),
    state: path.join(root, "data", "state.json"),
  },

  upload: {
    maxBytes: num(process.env.UPLOAD_MAX_BYTES, 25 * 1024 * 1024),
  },

  // External agent microservices. The backend orchestrates these; it does not
  // do their reasoning. Each must be configured for the pipeline to run.
  agents: {
    node1Url: process.env.NODE1_URL ?? "",
    node2Url: process.env.NODE2_URL ?? "",
    node3Url: process.env.NODE3_URL ?? "",
    copilotUrl: process.env.COPILOT_URL ?? "",
    coreSystemsUrl: process.env.CORE_SYSTEMS_URL ?? "",
    timeoutMs: num(process.env.AGENT_TIMEOUT_MS, 20_000),
  },

  // Queue driver: in-process now; BullMQ activates when REDIS_URL is set.
  queue: {
    redisUrl: process.env.REDIS_URL ?? "",
    concurrency: num(process.env.QUEUE_CONCURRENCY, 2),
  },

  // Trust layer. When FABRIC_ENABLED is unset the local hash-chain is used;
  // set it (and the connection material below) to record on Hyperledger Fabric.
  fabric: {
    enabled: (process.env.FABRIC_ENABLED ?? "") === "true",
    channel: process.env.FABRIC_CHANNEL ?? "auditchannel",
    chaincode: process.env.FABRIC_CHAINCODE ?? "audit-ledger",
    mspId: process.env.FABRIC_MSP_ID ?? "Org1MSP",
    peerEndpoint: process.env.FABRIC_PEER_ENDPOINT ?? "localhost:7051",
    peerHostAlias: process.env.FABRIC_PEER_HOST_ALIAS ?? "peer0.org1.example.com",
    tlsCertPath: process.env.FABRIC_TLS_CERT_PATH ?? "",
    certDir: process.env.FABRIC_CERT_DIR ?? "",
    keyDir: process.env.FABRIC_KEY_DIR ?? "",
  },

  cache: {
    dashboardTtlMs: num(process.env.CACHE_DASHBOARD_TTL_MS, 15_000),
  },

  // MAP confidence below this routes to the human review queue.
  review: {
    confidenceThreshold: num(process.env.REVIEW_CONFIDENCE, 0.85),
  },
} as const;

export type Config = typeof config;
