#!/usr/bin/env bash
# Tears down the Fabric test-network and removes channel artifacts / chaincode
# containers. Does not delete the downloaded fabric-samples (re-runnable bring-up).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SAMPLES_DIR="$(cd "$HERE/.." && pwd)/fabric-samples"

if [ -d "$SAMPLES_DIR/test-network" ]; then
  cd "$SAMPLES_DIR/test-network"
  ./network.sh down
  echo "==> Network down"
else
  echo "==> No fabric-samples found; nothing to tear down"
fi
