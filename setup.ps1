# ============================================================================
#  Canara ARC Shield - one-command setup for new team members.
#
#  Run once after cloning, from the repo root:
#      powershell -ExecutionPolicy Bypass -File .\setup.ps1
#
#  It checks prerequisites, installs all dependencies, pulls the LLM model,
#  and writes ready-to-use backend/.env + frontend/.env (with the correct
#  per-machine Fabric paths already filled in). After it finishes, follow
#  RUN.md to start the servers.
# ============================================================================
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
function Ok($m)   { Write-Host "  [OK]   $m" -ForegroundColor Green }
function Warn($m) { Write-Host "  [WARN] $m" -ForegroundColor Yellow }
function Step($m) { Write-Host "`n=== $m ===" -ForegroundColor Cyan }
function Have($c) { [bool](Get-Command $c -ErrorAction SilentlyContinue) }

Write-Host "Canara ARC Shield setup  (repo: $root)" -ForegroundColor White

# ---- 1. Prerequisites ------------------------------------------------------
Step "1/5  Checking prerequisites"
$missing = @()
foreach ($t in @("node","npm","python","docker","wsl","ollama")) {
  if (Have $t) { Ok "$t found" } else { Warn "$t NOT found"; $missing += $t }
}
if ($missing -contains "node" -or $missing -contains "python") {
  throw "Node.js and Python are required. Install them, then re-run setup.ps1."
}
if ($missing.Count -gt 0) {
  Warn "Missing optional-but-recommended tools: $($missing -join ', ')"
  Warn "docker+wsl are needed for the blockchain; ollama for the Node 1 LLM."
}

# ---- 2. JS + Python dependencies ------------------------------------------
Step "2/5  Installing dependencies (this can take a few minutes)"
Push-Location "$root\backend";  npm install --no-fund --no-audit; Pop-Location; Ok "backend npm packages"
Push-Location "$root\frontend"; npm install --no-fund --no-audit; Pop-Location; Ok "frontend npm packages"
python -m pip install --quiet fastapi "uvicorn[standard]" pydantic pydantic-settings httpx chromadb
Ok "python packages for the 3 nodes (incl. chromadb for Node 1's semantic tier)"

# ---- 3. Ollama models ------------------------------------------------------
Step "3/5  Pulling Node 1 Ollama models (embeddings + LLM)"
if (Have "ollama") {
  $models = @(
    @{ name = "nomic-embed-text"; note = "embeddings for the semantic tier, ~274MB" },
    @{ name = "deepseek-r1:8b";   note = "LLM tier, ~5GB" }
  )
  foreach ($m in $models) {
    if ((ollama list) -match [regex]::Escape($m.name)) { Ok "$($m.name) already present" }
    else { Write-Host "  pulling $($m.name) ($($m.note))..." -ForegroundColor Gray; ollama pull $m.name; Ok "$($m.name) pulled" }
  }
} else { Warn "ollama missing - skipping. Node 1 will run keyword-only (no semantic/LLM tiers)." }

# ---- 4. backend/.env (with real per-machine Fabric paths) ------------------
Step "4/5  Writing backend/.env"
$rootFwd = $root -replace '\\','/'
$org1 = "$rootFwd/fabric/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com"
$envPath = "$root\backend\.env"
if (Test-Path $envPath) {
  Warn "backend/.env already exists - leaving it untouched (delete it to regenerate)"
} else {
  $content = Get-Content "$root\backend\.env.example" -Raw
  $content = $content -replace 'FABRIC_ENABLED=false', 'FABRIC_ENABLED=true'
  $content = $content -replace 'FABRIC_TLS_CERT_PATH=.*', "FABRIC_TLS_CERT_PATH=$org1/peers/peer0.org1.example.com/tls/ca.crt"
  $content = $content -replace 'FABRIC_CERT_DIR=.*',     "FABRIC_CERT_DIR=$org1/users/User1@org1.example.com/msp/signcerts"
  $content = $content -replace 'FABRIC_KEY_DIR=.*',      "FABRIC_KEY_DIR=$org1/users/User1@org1.example.com/msp/keystore"
  Set-Content -Path $envPath -Value $content -Encoding utf8
  Ok "backend/.env created (FABRIC_ENABLED=true, node URLs + Fabric paths set)"
}

# ---- 5. frontend/.env ------------------------------------------------------
Step "5/5  Writing frontend/.env"
$feEnv = "$root\frontend\.env"
if (Test-Path $feEnv) { Warn "frontend/.env already exists - leaving it" }
else { Set-Content -Path $feEnv -Value "VITE_API_BASE_URL=http://localhost:4000/api" -Encoding utf8; Ok "frontend/.env created" }

# ---- Done ------------------------------------------------------------------
Write-Host "`n============================================================" -ForegroundColor Green
Write-Host " Setup complete. Next: start the servers (see RUN.md)." -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host @"

Start order (each in its OWN terminal):
  1. Nodes (3 terminals):  set `$env:PYTHONPATH then uvicorn 8001 / 8002 / 8003
  2. Blockchain (WSL2):    bash fabric/scripts/start-blockchain.sh
  3. Backend:              cd backend  ; npm run dev
  4. Frontend:             cd frontend ; npm run dev   ->  http://localhost:5173

Full copy-paste commands are in RUN.md.
"@ -ForegroundColor Gray
