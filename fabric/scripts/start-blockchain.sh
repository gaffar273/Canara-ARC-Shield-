#!/usr/bin/env bash
# One-command bring-up of the REAL Hyperledger Fabric audit ledger.
#
# Idempotent and re-runnable. Handles every state: fresh machine, after reboot,
# or network already up. Uses chaincode-as-a-service (CCAAS) so the peer never
# builds Go in-container — that legacy path OOMs on 16GB machines ("unexpected
# EOF"). The chaincode runs as its own container the peer talks to over gRPC.
#
# Run from WSL2 Ubuntu (Docker Desktop must be running):
#   bash fabric/scripts/start-blockchain.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FABRIC_DIR="$(cd "$HERE/.." && pwd)"
SAMPLES="$FABRIC_DIR/fabric-samples"
TN="$SAMPLES/test-network"
CC_SRC="$FABRIC_DIR/chaincode/audit-ledger"
CHANNEL="${FABRIC_CHANNEL:-auditchannel}"
CC_NAME="${FABRIC_CHAINCODE:-audit-ledger}"
IMAGE="${CC_NAME}_ccaas_image:latest"

if [ ! -d "$TN" ]; then
  echo "ERROR: fabric-samples/test-network not found at $TN" >&2
  echo "Run fabric/scripts/up.sh once first to download fabric-samples + binaries." >&2
  exit 1
fi

cd "$TN"
export PATH="$SAMPLES/bin:$PATH"
export FABRIC_CFG_PATH="$SAMPLES/config"

ORG1="$TN/organizations/peerOrganizations/org1.example.com"
ORG2="$TN/organizations/peerOrganizations/org2.example.com"
ORDERER_CA="$TN/organizations/ordererOrganizations/example.com/tlsca/tlsca.example.com-cert.pem"

# ---- 1. Network + channel -------------------------------------------------
# Idempotency across reboots: once the peer containers exist, their channel
# ledger lives on a Docker volume and survives a stop/reboot. Re-running
# `network.sh up createChannel` then fails with "ledger [auditchannel] already
# exists ACTIVE". So branch on container state:
#   running           -> nothing to do
#   present but stopped (post-reboot) -> just start them; ledger already there
#   absent            -> fresh bring-up + channel creation
if docker ps --format '{{.Names}}' | grep -q '^peer0.org1.example.com$'; then
  echo "==> [1/5] Network already running"
elif docker ps -a --format '{{.Names}}' | grep -q '^peer0.org1.example.com$'; then
  echo "==> [1/5] Containers present but stopped (post-reboot); starting them."
  echo "          Channel ledger persists on disk, so NOT recreating the channel."
  docker start orderer.example.com peer0.org1.example.com peer0.org2.example.com >/dev/null 2>&1 || true
  sleep 4
else
  echo "==> [1/5] Bringing up 2-org network + channel '$CHANNEL' (fresh)"
  ./network.sh up createChannel -c "$CHANNEL" -ca
fi

# ---- 2. CCAAS image (build once on a fresh machine, else reuse) -----------
if docker images --format '{{.Repository}}:{{.Tag}}' | grep -q "^${IMAGE}$"; then
  echo "==> [2/5] Reusing CCAAS image $IMAGE"
else
  echo "==> [2/5] Building CCAAS image $IMAGE (first run only; host build, not peer build)"
  docker build -f "$CC_SRC/Dockerfile" -t "$IMAGE" --build-arg CC_SERVER_PORT=9999 "$CC_SRC"
fi

# ---- 3. Chaincode definition (skip if already committed) ------------------
export CORE_PEER_TLS_ENABLED=true
export CORE_PEER_LOCALMSPID=Org1MSP
export CORE_PEER_TLS_ROOTCERT_FILE="$ORG1/peers/peer0.org1.example.com/tls/ca.crt"
export CORE_PEER_MSPCONFIGPATH="$ORG1/users/Admin@org1.example.com/msp"
export CORE_PEER_ADDRESS=localhost:7051

if peer lifecycle chaincode querycommitted -C "$CHANNEL" -n "$CC_NAME" >/dev/null 2>&1; then
  echo "==> [3/5] Chaincode '$CC_NAME' already committed on '$CHANNEL'"
else
  echo "==> [3/5] Deploying chaincode definition (CCAAS, no peer build)"
  ./network.sh deployCCAAS -c "$CHANNEL" -ccn "$CC_NAME" -ccp "$CC_SRC" -ccaasdocker false
fi

# ---- 4. (Re)start the chaincode containers --------------------------------
PKGID=$(peer lifecycle chaincode queryinstalled --output json \
  | jq -r ".installed_chaincodes[] | select(.label==\"${CC_NAME}_1.0\") | .package_id")
if [ -z "$PKGID" ] || [ "$PKGID" = "null" ]; then
  echo "ERROR: chaincode package not installed; deploy step did not complete." >&2
  exit 1
fi
echo "==> [4/5] Starting chaincode containers (pkg $PKGID)"
docker rm -f "peer0org1_${CC_NAME}_ccaas" "peer0org2_${CC_NAME}_ccaas" 2>/dev/null || true
for org in org1 org2; do
  docker run -d --name "peer0${org}_${CC_NAME}_ccaas" --network fabric_test \
    -e CHAINCODE_SERVER_ADDRESS=0.0.0.0:9999 \
    -e CHAINCODE_ID="$PKGID" -e CORE_CHAINCODE_ID_NAME="$PKGID" \
    "$IMAGE" >/dev/null
done
sleep 4

# ---- 5. Smoke test: write a block, read the chain, verify integrity -------
echo "==> [5/5] Smoke test (RecordBlock + VerifyChain)"
peer chaincode invoke -o localhost:7050 --ordererTLSHostnameOverride orderer.example.com \
  --tls --cafile "$ORDERER_CA" -C "$CHANNEL" -n "$CC_NAME" \
  --peerAddresses localhost:7051 --tlsRootCertFiles "$ORG1/peers/peer0.org1.example.com/tls/ca.crt" \
  --peerAddresses localhost:9051 --tlsRootCertFiles "$ORG2/peers/peer0.org2.example.com/tls/ca.crt" \
  -c '{"function":"RecordBlock","Args":["HEALTHCHECK","CIR-startup-probe","0xprobe"]}' >/dev/null 2>&1
sleep 2
VERDICT=$(peer chaincode query -C "$CHANNEL" -n "$CC_NAME" -c '{"function":"VerifyChain","Args":[]}')

echo
echo "============================================================"
echo " Fabric audit ledger is LIVE on channel '$CHANNEL'"
echo " Chaincode: $CC_NAME"
echo " VerifyChain -> $VERDICT"
echo "============================================================"
echo
echo "Now point the backend at it (already set in backend/.env):"
echo "  FABRIC_ENABLED=true"
echo "Then start the backend:  cd backend && npm run dev"
echo "(backend log should read: [ledger] using Hyperledger Fabric backend)"
