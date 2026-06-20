# Canara ARC Shield — Backend Service

AI-powered regulatory compliance & audit platform. This repo is **one microservice**: the
**Orchestrator + Intake + Trust (Blockchain) layer**. The AI agent nodes are **separate
services** owned by teammates and reached over HTTP through adapters.

Tech: Node.js + Express + **TypeScript** (strict). Package manager: npm.
Dev runtime: `tsx` (no cron/watchers for app logic). Build: `tsc` → `dist/`.

---

## Scope ownership

This service owns, end to end:

- **Layer 0 — Regulatory Intake**: real PDF upload, text extraction, metadata extraction, document store.
- **Orchestration**: drives a circular through Node 1 → Node 2 → Node 3 and persists state.
- **Trust Layer**: SHA-256 hashing, append-only hash-linked ledger, audit receipts, chain of custody.
- **Read APIs** that feed the frontend dashboards (executive, circular explorer, roles, blockchain, security, copilot proxy).
- **RBAC** at the API boundary.

This service does **not** own AI reasoning. It calls:

- **Node 1 — Regulatory Intelligence** (classification, retrieval, clause extraction)
- **Node 2 — MAP Engine** (LLM compliance mapping)
- **Node 3 — Verification Engine** (technical + policy verification)

Each is an external microservice behind an **adapter** with an env-configured base URL and a
dev **stub** fallback, so the full pipeline runs locally today and real services drop in by
setting a URL — no spine changes.

---

## Engineering rules (non-negotiable)

These are hard rules. Every change is reviewed against them.

1. **HLD documented** — keep the High-Level Design in this file current. Any new service
   boundary, queue, or data flow updates the HLD section before code lands.
2. **LLD documented** — keep the Low-Level Design current: module responsibilities, function
   contracts, data shapes, and the API table. Code follows the LLD, not the reverse.
3. **Minimum comments** — code is self-documenting via clear names. Comment only *why*, never
   *what*. No narration comments, no commented-out code.
4. **Write once, reuse everywhere (DRY)** — one implementation per concept. Shared logic lives
   in `services/` or `utils/` and is imported. No copy-paste. If you write it twice, extract it.
5. **No duplicate APIs** — exactly one endpoint per piece of information. The same data is never
   served by two routes. Before adding a route, check the API table in the LLD; extend, don't fork.
6. **No race conditions** — all shared-state mutation goes through a single guarded path. Pipeline
   stage transitions are atomic and idempotent. Ledger appends are serialized (one writer). No
   read-modify-write on shared state without a lock/queue.
7. **Caching + queues** — cache derived/expensive reads (with explicit TTL + invalidation). For
   background/async work use a **queue (BullMQ), never cron**. Polling and time-based schedulers
   are not allowed; work is event/queue driven.

Additional standing conventions:

- Secure defaults: validate all input, parameterized/escaped external calls, never log secrets or PII.
- Every network-exposed route states its auth requirement; nothing unauthenticated ships silently.
- Errors flow through one error handler; routes throw typed errors, never format responses ad hoc.
- One response envelope shape across all routes.

---

## HLD — High-Level Design

```
                 ┌──────────────────────────────────────────────────────────┐
   PDF / upload  │                  ARC Shield Backend (this)                │
   ───────────►  │                                                          │
                 │  Layer 0 Intake ─► Orchestrator ─► Trust Layer (Ledger)   │
                 │       │                  │                  │             │
                 │  Document Store      Pipeline State     Hash-linked       │
                 │  (disk)              (store)            audit chain       │
                 └──────────┬───────────────┬───────────────────────────────┘
                            │ HTTP adapters  │
              ┌─────────────┼────────────────┼──────────────┐
              ▼             ▼                ▼               
        Node 1            Node 2          Node 3
     Intelligence       MAP Engine      Verification
     (external svc)    (external svc)   (external svc)
```

Pipeline lifecycle for one circular:

`RECEIVED → CLASSIFYING (N1) → MAPPING (N2) → VERIFYING (N3) → SEALED (Trust) → COMPLETE`

- Long-running agent calls run as **BullMQ jobs**; the API returns a job/circular id and the
  client reads status from the state store. No request blocks on the full pipeline.
- Every stage transition appends a block to the audit chain (chain of custody). The Trust Layer
  has two interchangeable backends behind one `LedgerBackend` interface: a local **hash-chain**
  (default) and **Hyperledger Fabric** (`FABRIC_ENABLED=true`). See `fabric/README.md`.
- Caching sits in front of read-heavy dashboard endpoints.

---

## LLD — Low-Level Design (target layout)

```
backend/
  src/
    config/        env + constants (ports, adapter URLs, TTLs, queue names)
    middleware/    auth/RBAC, error handler, validation, request context
    routes/        thin HTTP layer; no business logic
    services/      business logic (intake, orchestrator, ledger, dashboard, copilot)
    adapters/      external agent clients (node1, node2, node3) + stub fallback
    store/         persistence + state (single writer per resource)
    queue/         BullMQ setup, workers, job definitions
    utils/         hashing, response envelope, errors, ids
  uploads/         raw uploaded files (gitignored)
  data/            document store + ledger (gitignored)
```

Module contracts and the **single** API table live here and are updated with every route or
service added. (To be filled in as modules are implemented — one row per endpoint, no duplicates.)

### API table (single source of truth — no duplicates)

Envelope: every response is `{ ok, data }` or `{ ok, error }`. Role is sent via `x-role`
header (`compliance` | `it` | `cxo` | `auditor`).

| Method | Path | Auth | Serves |
|--------|------|------|--------|
| GET  | `/api/health` | public | Liveness probe |
| POST | `/api/circulars` | compliance | Upload + intake a circular PDF (multipart `file`); returns the `Circular` |
| GET  | `/api/circulars` | any role | List all circulars |
| GET  | `/api/circulars/:id` | any role | One circular by id |
| POST | `/api/circulars/:id/process` | compliance | Kick off async pipeline; returns `{ started }` (202) |
| GET  | `/api/circulars/:id/pipeline` | any role | Pipeline record (stage, maps, verifications, receipt) |
| GET  | `/api/dashboard/summary` | any role | Aggregated executive metrics (cached, TTL) |
| GET  | `/api/dashboard/role/:role` | any role | MAPs + verifications scoped to a role's workspace |
| GET  | `/api/ledger/chain` | any role | Full hash-linked ledger |
| GET  | `/api/ledger/verify` | any role | Chain integrity check `{ valid, brokenAt }` |
| GET  | `/api/ledger/custody/:refId` | any role | Chain of custody for one circular |
| POST | `/api/copilot/ask` | any role | RAG-style answer with citations + verification status |

### Module contracts

- `services/intakeService` — `ingest(file)` validates PDF by magic bytes, extracts raw text and
  **neutral file metadata only** (bytes, pages, hash), stores the document, creates the circular,
  records `CIRCULAR_RECEIVED`. It does NOT classify — regulator, sections, issued date and the
  real title are decided by the Node 1 agent and written back during the CLASSIFYING transition.
- `services/orchestrator` — `start(id)` enqueues; the worker drives N1→N2→N3→seal with atomic,
  idempotent `stateStore.transition` calls and a ledger append per stage.
- `services/ledgerService` — Trust Layer API over the hash-linked ledger; the only place that
  appends custody events and seals audit receipts.
- `services/dashboardService` — derives metrics from pipeline state; TTL-cached, invalidated by
  the orchestrator on completion.
- `services/copilotService` — keyword retrieval over stored clauses; attaches citations +
  verification status; answer text proxies to Node 1 when its URL is set.
- `adapters/node{1,2,3}` — external agent clients; call the service when its URL is set, else a
  deterministic dev stub.
- `store/stateStore` + `store/ledgerStore` — single-writer (Mutex) persistence; atomic file writes.
- `queue/` — `JobQueue` interface; in-process driver now, BullMQ when `REDIS_URL` is set.

---

## Conventions

- Response envelope: `{ ok: boolean, data?: T, error?: { code, message } }`.
- IDs are generated centrally in `utils`.
- Config is read only from `config/`; no `process.env` access scattered across modules.
- Adapters never throw raw transport errors upward; they return typed results or fall to stub.
