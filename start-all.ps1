# ============================================================================
#  Canara ARC Shield - one-command launcher for ALL services.
#
#  Run from the repo root:
#      powershell -ExecutionPolicy Bypass -File .\start-all.ps1
#
#  Opens each server in its OWN window (so you keep per-service logs), in the
#  required order: nodes -> blockchain -> backend -> frontend. Run setup.ps1
#  once first if you haven't installed dependencies.
#
#  Flags:
#      -SkipBlockchain   don't start Fabric (backend then uses the hash-chain)
#      -SkipFrontend     don't start the Vite dev server
# ============================================================================
param(
  [switch]$SkipBlockchain,
  [switch]$SkipFrontend
)
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$wslDistro = "Ubuntu-26.04"

function Ok($m)   { Write-Host "  [OK]   $m" -ForegroundColor Green }
function Warn($m) { Write-Host "  [WARN] $m" -ForegroundColor Yellow }
function Step($m) { Write-Host "`n=== $m ===" -ForegroundColor Cyan }

# Open one service in its own titled PowerShell window that stays open (-NoExit).
function Start-Window($title, $command) {
  Start-Process powershell -ArgumentList @(
    "-NoExit", "-Command",
    "`$Host.UI.RawUI.WindowTitle = '$title'; $command"
  ) | Out-Null
}

Write-Host "Canara ARC Shield launcher  (repo: $root)" -ForegroundColor White

# ---- 1. The AI nodes + core systems ----------------------------------------
Step "1/4  Starting the AI nodes + Core Systems API (8001/8002/8003/8004)"
$nodes = @(
  @{ t = "Node1-Intelligence"; mod = "node1_intelligence.api:app";        port = 8001 },
  @{ t = "Node2-MAP-Engine";   mod = "node2_map_engine.api:app";          port = 8002 },
  @{ t = "Node3-Verification"; mod = "node3_verification_engine.api:app"; port = 8003 },
  @{ t = "Core-Systems-API";   mod = "core_systems.api:app";              port = 8004 }
)
foreach ($n in $nodes) {
  # PYTHONUTF8=1 forces UTF-8 stdout so the engines' box-drawing/diff log output
  # can't raise UnicodeEncodeError under the Windows console codepage (cp1252),
  # which the pipeline would otherwise swallow as a per-clause failure.
  $cmd = "cd '$root'; `$env:PYTHONPATH = '$root'; `$env:PYTHONUTF8 = '1'; " +
         "python -m uvicorn $($n.mod) --port $($n.port) --host 127.0.0.1"
  Start-Window $n.t $cmd
  Ok "$($n.t) -> :$($n.port)"
}

# ---- 2. Blockchain (Fabric on Docker, via WSL2) ----------------------------
Step "2/4  Starting the blockchain (Hyperledger Fabric on Docker)"
if ($SkipBlockchain) {
  Warn "-SkipBlockchain set: backend will fall back to the local hash-chain."
} else {
  $dockerUp = $false
  try { docker info *> $null; $dockerUp = ($LASTEXITCODE -eq 0) } catch { $dockerUp = $false }
  if (-not $dockerUp) {
    Warn "Docker is not responding. Start Docker Desktop, then either re-run this"
    Warn "script or bring the chain up manually in WSL with:"
    Warn "  bash /mnt/c/hack/Canara-ARC-Shield-/fabric/scripts/start-blockchain.sh"
  } else {
    Ok "Docker is up"
    $wslPath = "/mnt/" + ($root -replace '^([A-Za-z]):','$1' -replace '\\','/')
    $wslPath = $wslPath.Substring(0,5) + $wslPath.Substring(5,1).ToLower() + $wslPath.Substring(6)
    $script = "$wslPath/fabric/scripts/start-blockchain.sh"
    Write-Host "  Running (this can take a minute on first boot)..." -ForegroundColor Gray
    wsl -d $wslDistro -- bash $script
    if ($LASTEXITCODE -eq 0) { Ok "Blockchain is live" }
    else { Warn "Blockchain script exited with code $LASTEXITCODE - check the output above." }
  }
}

# ---- 3. Backend ------------------------------------------------------------
Step "3/4  Starting the backend orchestrator (:4000)"
Start-Window "Backend-:4000" "cd '$root\backend'; npm run dev"
Ok "Backend starting -> http://localhost:4000"

# ---- 4. Frontend -----------------------------------------------------------
Step "4/4  Starting the frontend (:5173)"
if ($SkipFrontend) {
  Warn "-SkipFrontend set: not starting the Vite dev server."
} else {
  Start-Window "Frontend-:5173" "cd '$root\frontend'; npm run dev"
  Ok "Frontend starting -> http://localhost:5173"
}

Write-Host "`n============================================================" -ForegroundColor Green
Write-Host " All services launched in their own windows." -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host @"

Each server has its own window - watch those for logs.
Give the backend ~5s to connect; a healthy boot prints:
  [ledger] using Hyperledger Fabric backend
  [arc-shield] listening on :4000 (development) agents=live/live/live

Open the app at:  http://localhost:5173
Health check + terminal pipeline test are in RUN.md (sections 5-6).
"@ -ForegroundColor Gray
