# Running & Debugging Canara ARC Shield

This is the hands-on runbook. It starts every server **in your own terminal** so you
see its logs live and can Ctrl+C / restart it yourself. For architecture and the API
list, see [README.md](./README.md).

> **The golden rule:** one server = one terminal window. Don't background them. The
> whole point is that each window shows that server's logs so you can debug.

**Startup order (matters):** nodes → **blockchain** → backend → frontend. The backend
connects to the live chain and to the nodes when it boots, so those must be up first.

> **No LLM / no Ollama.** The pipeline runs fully deterministic (rule-based
> classification + change analysis) — there are no external AI calls and nothing
> to install for it. The LLM hooks still exist behind `NODE1_LLM_URL` /
> `NODE2_LLM_URL` env vars but are intentionally blank/disabled.

---

## Quick start (recommended)

Two commands. `setup.ps1` once after cloning, `start-all.ps1` every time you
want the app running — it opens every server in its own window in the right
order (nodes → blockchain → backend → frontend):

```powershell
# from repo root, once after cloning:
powershell -ExecutionPolicy Bypass -File .\setup.ps1

# then, with Docker Desktop running:
powershell -ExecutionPolicy Bypass -File .\start-all.ps1
```

When the backend window prints `agents=live/live/live`, open **http://localhost:5173**.
No Docker? Use `.\start-all.ps1 -SkipBlockchain` and set `FABRIC_ENABLED=false`
in `backend/.env` (local hash-chain fallback, dev only).

The sections below are the same startup done **manually, one terminal per
server** — use them when you need to watch or restart an individual service.

---

## 0. One-time setup (manual alternative to setup.ps1)

```powershell
# from repo root: C:\hack\Canara-ARC-Shield-
cd backend ; npm install ; cd ..
cd frontend ; npm install ; cd ..
pip install fastapi "uvicorn[standard]" pydantic pydantic-settings httpx chromadb sentence-transformers
```

`chromadb` is required: Node 1's semantic tier stores taxonomy examples in a
local vector DB, and the node will not start without it. `sentence-transformers`
powers the offline embedding tier; without it Node 1 degrades to keyword-only
classification (still works).

For the blockchain you also need **Docker Desktop** running and **WSL2 Ubuntu** installed.

---

## 1. Start the AI nodes + Core Systems — 4 terminals

Each service prints its requests and errors to its own window. Open **four** PowerShell
terminals. In **each**, first set the Python path, then start one service:

**Terminal 1 — Node 1 (Intelligence):**
```powershell
cd C:\hack\Canara-ARC-Shield-
$env:PYTHONPATH = "C:\hack\Canara-ARC-Shield-"
python -m uvicorn node1_intelligence.api:app --port 8001 --host 127.0.0.1
```

**Terminal 2 — Node 2 (MAP Engine):**
```powershell
cd C:\hack\Canara-ARC-Shield-
$env:PYTHONPATH = "C:\hack\Canara-ARC-Shield-"
python -m uvicorn node2_map_engine.api:app --port 8002 --host 127.0.0.1
```

**Terminal 3 — Node 3 (Verification):**
```powershell
cd C:\hack\Canara-ARC-Shield-
$env:PYTHONPATH = "C:\hack\Canara-ARC-Shield-"
python -m uvicorn node3_verification_engine.api:app --port 8003 --host 127.0.0.1
```

**Terminal 4 — Core Systems API (the bank's department systems):**
```powershell
cd C:\hack\Canara-ARC-Shield-
$env:PYTHONPATH = "C:\hack\Canara-ARC-Shield-"
python -m uvicorn core_systems.api:app --port 8004 --host 127.0.0.1
```

This service stands in for the bank's core/department systems (IAM, core-banking
DB, GRC, etc.). Node 3 queries it over HTTP to read the **actual** operational
state (retention years, MFA flags, capital ratios) and computes PASS/FAIL by
comparing against each obligation's required value — there are no stored verdicts.
Node 3 reaches it at `CORE_SYSTEMS_URL` (default `http://localhost:8004`); if it's
down, Node 3 cannot assert compliance and every verdict degrades to REVIEW.

Each should end with `Uvicorn running on http://127.0.0.1:800X`. Leave them running.
When a circular is processed you'll see lines like `POST /analyze HTTP/1.1 200 OK` in
the Node 1 window — **that is your pipeline log.**

---

## 2. Start the blockchain — REQUIRED, before the backend

The audit ledger is **not optional** — this is an audit/compliance platform and every
pipeline stage is sealed on the real Hyperledger Fabric chain. Start it before the
backend so the backend connects to a live chain on boot.

**Prerequisites:** Docker Desktop running, WSL2 Ubuntu installed.

From a **WSL2 Ubuntu** shell (NOT PowerShell), one command brings up the whole chain:

```bash
bash /mnt/c/hack/Canara-ARC-Shield-/fabric/scripts/start-blockchain.sh
```

This script is idempotent — run it on a fresh machine, after a reboot, or when the
network is already up; it detects the state and does only what's needed. It:
1. brings up the 2-org network + `auditchannel` (if not already running),
2. builds the chaincode image once / reuses it after (CCAAS — the peer never builds Go
   in-container, which is what OOMs on 16GB machines),
3. commits the chaincode definition (if not already committed),
4. starts the chaincode containers,
5. smoke-tests it and prints `VerifyChain -> {"valid":true,"brokenAt":-1}`.

When you see that `{"valid":true...}` line, **the chain is live.** `backend/.env` already
has `FABRIC_ENABLED=true`, so the backend uses it automatically.

To stop the chain later: `bash /mnt/c/hack/Canara-ARC-Shield-/fabric/scripts/down.sh`.

> **First-ever run only:** if `fabric-samples/` was never downloaded, run
> `bash /mnt/c/hack/Canara-ARC-Shield-/fabric/scripts/up.sh` once first (it fetches
> fabric-samples + binaries + Docker images, ~1.5GB), then use `start-blockchain.sh`
> from then on.

> **Emergency fallback (only if Docker is broken):** the backend can run on a local
> hash-chain ledger by setting `FABRIC_ENABLED=false` in `backend/.env`. Development-only
> degraded mode — the real deployment uses Fabric.

---

## 3. Start the backend — 1 terminal

**Terminal 4 — Backend orchestrator:**
```powershell
cd C:\hack\Canara-ARC-Shield-\backend
npm run dev
```

Healthy startup looks like:
```
[ledger] using Hyperledger Fabric backend
[arc-shield] listening on :4000 (development) agents=live/live/live
```

- `[ledger] using Hyperledger Fabric backend` confirms it connected to the chain from
  step 2. If it says `hash-chain`, then `FABRIC_ENABLED` is false or the chain isn't up.
- `agents=live/live/live` means it can see all 3 nodes. If you see `stub`, the node URLs
  in `backend/.env` are blank or a node is down.

**This window is your most important log** — pipeline failures print here, e.g.:
```
[queue:pipeline] job CIR-xxxx failed: Agent http://localhost:8001/analyze timed out
```

---

## 4. Start the frontend — 1 terminal

**Terminal 5 — Frontend:**
```powershell
cd C:\hack\Canara-ARC-Shield-\frontend
npm run dev
```

Open the URL it prints (**http://localhost:5173**).

---

## 5. Quick health check (any terminal)

```powershell
4000,8001,8002,8003,8004 | ForEach-Object {
  $u = if ($_ -eq 4000) { "http://localhost:4000/api/health" } else { "http://localhost:$_/health" }
  try { Invoke-RestMethod $u -TimeoutSec 4 | Out-Null; "  $_ OK" } catch { "  $_ DOWN" }
}
```

Confirm the chain is live (from WSL2 Ubuntu):
```bash
bash /mnt/c/hack/Canara-ARC-Shield-/fabric/scripts/start-blockchain.sh   # re-run = health check
```

---

## 6. Test the pipeline from the terminal (bypasses the UI)

This proves the backend + nodes + chain work even if the screen looks stuck. A sample
circular `rbi_circular_16.pdf` is in the repo root.

```powershell
$base = "http://localhost:4000/api"; $h = @{ "x-role" = "compliance" }

# upload
$up = Invoke-RestMethod "$base/circulars" -Method Post -Headers $h -Form @{ file = Get-Item "C:\hack\Canara-ARC-Shield-\rbi_circular_16.pdf" }
$id = $up.data.id; "uploaded $id"

# start pipeline
Invoke-RestMethod "$base/circulars/$id/process" -Method Post -Headers $h | Out-Null

# poll status until COMPLETE (fast — the pipeline is fully rule-based, no LLM)
do {
  Start-Sleep 3
  $pl = Invoke-RestMethod "$base/circulars/$id/pipeline" -Headers $h
  "stage=$($pl.data.stage)  maps=$($pl.data.maps.Count)  verifs=$($pl.data.verifications.Count)"
} while ($pl.data.stage -notin "COMPLETE","FAILED")

# confirm it was sealed on-chain
(Invoke-RestMethod "$base/ledger/verify" -Headers $h).data         # -> valid=True
(Invoke-RestMethod "$base/ledger/custody/$id" -Headers $h).data.events.kind   # 5 custody events
```

This proves the backend + nodes + chain work independently of the UI. The UI now
polls, so it tracks the same stages live (see the auto-refresh note below).

---

## UI auto-refresh after upload (resolved)

The detail view and the executive dashboard now **poll** while a circular is in
flight: they refetch `/circulars/:id/pipeline` (and `/dashboard/summary`) every few
seconds and stop once the stage reaches `COMPLETE` or `FAILED`. After uploading you
can stay on the circular and watch the live stage bar climb
RECEIVED → CLASSIFYING → MAPPING → VERIFYING → SEALED → COMPLETE — no manual refresh
needed.

---

## Troubleshooting

| What you see | Cause | Fix |
|---|---|---|
| Backend log: `agents=stub/stub/stub` | Node URLs blank in `backend/.env` | Set `NODE1_URL=http://localhost:8001` (and 8002/8003), restart backend |
| Backend log: `Agent .../analyze timed out` | A node is up but hung/overloaded | Check that node's window for a traceback; restart it. Raise `AGENT_TIMEOUT_MS` in `backend/.env` only as a last resort |
| `UNPROCESSABLE: Unable to parse PDF` | PDF has no extractable text layer | Use a real text PDF (e.g. the included `rbi_circular_16.pdf`) |
| Node won't start: `ModuleNotFoundError` | `PYTHONPATH` not set in that terminal | Re-run the `$env:PYTHONPATH = ...` line before uvicorn |
| Backend log: `hash-chain` not `Fabric` | Chain not up, or `FABRIC_ENABLED=false` | Run step 2 (`start-blockchain.sh`), confirm `FABRIC_ENABLED=true`, restart backend |
| Ledger calls fail / backend can't reach chain | Fabric containers down | Re-run `start-blockchain.sh` (it restarts what's missing) |
| `start-blockchain.sh` fails: `ledger [auditchannel] already exists ACTIVE` / `failed to join channel` | After a reboot the peer containers were stopped but their channel ledger persisted on disk; the old script tried to recreate the channel | Fixed in `start-blockchain.sh` — it now detects stopped-but-present containers and just **starts** them instead of recreating the channel. Pull the latest script. If still stuck, `docker start orderer.example.com peer0.org1.example.com peer0.org2.example.com` then re-run the script (it will skip to chaincode + smoke test) |
| Chaincode containers `Exited (255)` after reboot | CCAAS containers don't auto-restart | Re-run `start-blockchain.sh` — step 4 force-restarts them with the correct package id |
| Chaincode deploy fails `unexpected EOF` | Legacy `deployCC` peer-build OOM | Use `start-blockchain.sh` — it deploys via CCAAS and avoids the peer build |
| Port already in use | An old server is still running | `Get-NetTCPConnection -LocalPort 4000 -State Listen` then `Stop-Process -Id <pid> -Force` |

### Stop a server on a port
```powershell
$p = 4000   # or 5173, 8001, 8002, 8003
(Get-NetTCPConnection -LocalPort $p -State Listen).OwningProcess |
  Select-Object -Unique | ForEach-Object { Stop-Process -Id $_ -Force }
```

---

## Service map

| Service | Terminal | Port | Start command |
|---|---|---|---|
| Node 1 Intelligence | 1 | 8001 | `python -m uvicorn node1_intelligence.api:app --port 8001` |
| Node 2 MAP Engine | 2 | 8002 | `python -m uvicorn node2_map_engine.api:app --port 8002` |
| Node 3 Verification | 3 | 8003 | `python -m uvicorn node3_verification_engine.api:app --port 8003` |
| Core Systems API | 4 | 8004 | `python -m uvicorn core_systems.api:app --port 8004` |
| Blockchain (Fabric) | WSL2 Ubuntu | 7051 | `bash fabric/scripts/start-blockchain.sh` |
| Backend | 5 | 4000 | `npm run dev` (in `backend/`) |
| Frontend | 6 | 5173 | `npm run dev` (in `frontend/`) |
