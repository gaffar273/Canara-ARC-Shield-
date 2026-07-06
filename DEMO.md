# Demo Script — Canara ARC Shield (live walkthrough)

Simple start-to-end script for the live demo. Keep this file open on a second
screen. For setup details see [RUN.md](./RUN.md).

---

## Before the demo (10 minutes before)

1. Start **Docker Desktop**, wait until it says "running".
2. In PowerShell:
   ```powershell
   cd C:\hack\Canara-ARC-Shield-
   powershell -ExecutionPolicy Bypass -File .\start-all.ps1
   ```
3. Wait for the **backend window** to print `agents=live/live/live`.
4. Open **http://localhost:5173** as **Compliance Officer**.

---

## The demo, step by step

### Step 1 — Upload a circular
> *"A new RBI circular just arrived."*

- **Circular Explorer** → **Upload Circular** → pick `rbi_circular_16.pdf` (repo root).
- Start processing. The stage bar moves by itself:
  RECEIVED → CLASSIFYING → MAPPING → VERIFYING → SEALED → COMPLETE. No refresh needed.

### Step 2 — Show what the system understood
> *"It broke the circular into obligations and checked each against our live bank systems."*

- Scroll to **Clause Overview** and point at the colors:
  - **Green MAPPED** — bank already complies, verified automatically
  - **Yellow PENDING** — needs a human review
  - **Red FLAGGED** — violation, caught automatically

### Step 3 — Human review
> *"Low-confidence items always go to a human — AI never gets the final word."*

- **Review Queue** → open the waiting item → **Approve** with a short note.
- The decision is permanently sealed on the blockchain.

### Step 4 — Catch a violation live (the wow moment)
> *"Now watch what happens when a bank system drifts out of compliance."*

1. Bottom-left gear → switch role to **IT Team**.
2. **Security & Trust** → Core Systems Posture → change a parameter behind a
   green clause (e.g. the recovery/RPO value) to a bad value → **Save**.
3. Back to the circular → **reprocess**.
4. The green clause turns **red FLAGGED**; on the **Executive Dashboard**,
   **Risk Alerts** jumps up. **Pause here.**
5. Fix the value back, reprocess → green again. *"Continuous compliance monitoring."*

### Step 5 — Prove tamper-evidence
> *"Every step was sealed on a real Hyperledger Fabric blockchain."*

- **Blockchain Trust Center** → chain shows **valid** → open the circular's
  **chain of custody** → 6 events, from CIRCULAR_RECEIVED to HUMAN_DECISION.

### Step 6 — Copilot (optional closer)
- **Compliance Copilot** → ask *"what are the reporting requirements?"* →
  the answer cites real clauses, nothing made up.

### Step 7 — Roles (if judges ask about access control)
- **Role Workspace** → each role sees only its own MAPs; Auditor/RBI is read-only.

---

## If something breaks

| Problem | What to do |
|---|---|
| Pipeline stuck or FAILED | Read the **backend window** — the error prints there. Restart that one service in its own window. |
| Blockchain won't start | In `backend\.env` set `FABRIC_ENABLED=false`, restart the backend window. The demo still works fully on the local ledger. |
| A page looks empty | Click its Refresh button, or check the role you're signed in as (bottom-left). |

Quick "is everything up" check (any terminal):

```powershell
4000,8001,8002,8003,8004 | ForEach-Object {
  $u = if ($_ -eq 4000) { "http://localhost:4000/api/health" } else { "http://localhost:$_/health" }
  try { Invoke-RestMethod $u -TimeoutSec 4 | Out-Null; "  $_ OK" } catch { "  $_ DOWN" }
}
```

## Talking points if asked "where is the AI?"

- The engine is **deterministic and fully auditable** — every verdict is
  reproducible and traceable, which is what bank auditors require. No
  hallucination risk, no external AI calls (per competition rules).
- The architecture is **LLM-ready by design**: any OpenAI-compatible model
  plugs in via one env var (`NODE1_LLM_URL` / `NODE2_LLM_URL`) with automatic
  fallback — zero code changes.
