#!/usr/bin/env bash
# Boots the Hyperledger Fabric 2-org test-network and deploys the audit-ledger
# chaincode. Uses the official fabric-samples (the supported, reliable path) so
# we never hand-roll crypto material or configtx.
#
# Prereqs: docker + docker compose running, curl, and a POSIX shell.
# Re-runnable: tears down any existing network first.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FABRIC_DIR="$(cd "$HERE/.." && pwd)"
SAMPLES_DIR="$FABRIC_DIR/fabric-samples"
CHANNEL="${FABRIC_CHANNEL:-auditchannel}"
CC_NAME="${FABRIC_CHAINCODE:-audit-ledger}"
CC_SRC="$FABRIC_DIR/chaincode/audit-ledger"
FABRIC_VERSION="${FABRIC_VERSION:-2.5.9}"
CA_VERSION="${CA_VERSION:-1.5.13}"

echo "==> Fabric test-network bring-up (channel=$CHANNEL chaincode=$CC_NAME)"

if [ ! -d "$SAMPLES_DIR/test-network" ]; then
  echo "==> Fetching fabric-samples (~repo) + binaries + docker images (first run only)"
  # Clone the samples repo explicitly: install-fabric.sh skips its own clone when
  # the fabric-samples dir already exists, which can leave us without
  # test-network/. A partial/non-git dir from an earlier run is removed first.
  if [ -d "$SAMPLES_DIR" ] && [ ! -d "$SAMPLES_DIR/.git" ]; then
    echo "==> Removing incomplete fabric-samples dir"
    rm -rf "$SAMPLES_DIR"
  fi
  if [ ! -d "$SAMPLES_DIR/.git" ]; then
    git clone --branch "v${FABRIC_VERSION}" --depth 1 \
      https://github.com/hyperledger/fabric-samples.git "$SAMPLES_DIR" \
      || git clone --depth 1 https://github.com/hyperledger/fabric-samples.git "$SAMPLES_DIR"
  fi
  # Binaries (into fabric-samples/bin) + docker images (cached if already pulled).
  curl -sSL https://raw.githubusercontent.com/hyperledger/fabric/main/scripts/install-fabric.sh \
    -o "$FABRIC_DIR/install-fabric.sh"
  chmod +x "$FABRIC_DIR/install-fabric.sh"
  ( cd "$FABRIC_DIR" && ./install-fabric.sh --fabric-version "$FABRIC_VERSION" --ca-version "$CA_VERSION" binary docker )
fi

cd "$SAMPLES_DIR/test-network"

echo "==> Tearing down any existing network"
./network.sh down

echo "==> Starting network + creating channel '$CHANNEL'"
./network.sh up createChannel -c "$CHANNEL" -ca

echo "==> Deploying chaincode '$CC_NAME' (Go)"
./network.sh deployCC -c "$CHANNEL" -ccn "$CC_NAME" -ccp "$CC_SRC" -ccl go

echo "==> Done. Connection material is under:"
echo "    $SAMPLES_DIR/test-network/organizations/peerOrganizations/org1.example.com"
echo
echo "Set these in backend/.env (see fabric/connection-org1.env for exact paths):"
echo "    FABRIC_ENABLED=true"
