# ARC Shield — Backend

The orchestrator + intake + blockchain trust layer. It takes a circular PDF,
runs it through the AI node microservices (classify → map → verify), and records
every step on Hyperledger Fabric. The frontend and the nodes plug into this.

## Run

```bash
npm install
cp .env.example .env     # then fill the URLs (see below)
npm run dev              # http://localhost:4000
```

Build for prod: `npm run build && npm start`

## What you must configure (.env)

The backend does NOT do AI itself — it calls the node services. Set their URLs:

```
NODE1_URL=     # Classification + clause extraction
NODE2_URL=     # MAP generation
NODE3_URL=     # Verification
COPILOT_URL=   # RAG chatbot answers
```

If a node URL is missing, that pipeline step fails with a clear error.

Blockchain: `FABRIC_ENABLED=false` uses a local hash-chain (zero infra, good for
dev). Set `true` + the cert paths to use real Fabric (see `../fabric/README.md`).

## API

| Method | Path | Who | Purpose |
|--------|------|-----|---------|
| POST | `/api/circulars` | compliance | Upload a circular PDF (`file`) |
| GET | `/api/circulars` | any | List circulars |
| GET | `/api/circulars/:id` | any | One circular |
| POST | `/api/circulars/:id/process` | compliance | Run the pipeline |
| GET | `/api/circulars/:id/pipeline` | any | Pipeline status + results |
| GET | `/api/dashboard/summary` | any | Executive metrics |
| GET | `/api/dashboard/role/:role` | any | Role workspace data |
| GET | `/api/ledger/chain` | any | Full blockchain |
| GET | `/api/ledger/verify` | any | Chain integrity check |
| GET | `/api/ledger/custody/:id` | any | Chain of custody for a circular |
| POST | `/api/copilot/ask` | any | Ask the compliance copilot |

Role is sent via the `x-role` header: `compliance` | `it` | `cxo` | `auditor`.
Responses are `{ ok: true, data }` or `{ ok: false, error }`.

## Stack

Node + Express + TypeScript · multer + pdf-parse (intake) · Hyperledger Fabric
Gateway SDK (trust layer). Architecture and rules: see `CLAUDE.md`.
