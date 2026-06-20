#!/usr/bin/env bash
# Prints the backend/.env lines pointing at the test-network's Org1 connection
# material. Run after up.sh, then paste the output into backend/.env.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ORG="$(cd "$HERE/.." && pwd)/fabric-samples/test-network/organizations/peerOrganizations/org1.example.com"

if [ ! -d "$ORG" ]; then
  echo "Org1 material not found. Run fabric/scripts/up.sh first." >&2
  exit 1
fi

echo "FABRIC_ENABLED=true"
echo "FABRIC_CHANNEL=${FABRIC_CHANNEL:-auditchannel}"
echo "FABRIC_CHAINCODE=${FABRIC_CHAINCODE:-audit-ledger}"
echo "FABRIC_MSP_ID=Org1MSP"
echo "FABRIC_PEER_ENDPOINT=localhost:7051"
echo "FABRIC_PEER_HOST_ALIAS=peer0.org1.example.com"
echo "FABRIC_TLS_CERT_PATH=$ORG/peers/peer0.org1.example.com/tls/ca.crt"
echo "FABRIC_CERT_DIR=$ORG/users/User1@org1.example.com/msp/signcerts"
echo "FABRIC_KEY_DIR=$ORG/users/User1@org1.example.com/msp/keystore"
