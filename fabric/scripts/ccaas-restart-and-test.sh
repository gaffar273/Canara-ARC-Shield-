#!/usr/bin/env bash
# Restarts the audit-ledger CCaaS containers with the correct installed
# package id, then smoke-tests the chaincode (RecordBlock + GetChain + VerifyChain).
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../fabric-samples/test-network"
export PATH="$PWD/../bin:$PATH"
export FABRIC_CFG_PATH="$PWD/../config"
export CORE_PEER_TLS_ENABLED=true
export CORE_PEER_LOCALMSPID=Org1MSP
export CORE_PEER_TLS_ROOTCERT_FILE=$PWD/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt
export CORE_PEER_MSPCONFIGPATH=$PWD/organizations/peerOrganizations/org1.example.com/users/Admin@org1.example.com/msp
export CORE_PEER_ADDRESS=localhost:7051

ORDERER_CA=$PWD/organizations/ordererOrganizations/example.com/tlsca/tlsca.example.com-cert.pem
ORG2_CA=$PWD/organizations/peerOrganizations/org2.example.com/peers/peer0.org2.example.com/tls/ca.crt

PKGID=$(peer lifecycle chaincode queryinstalled --output json \
  | jq -r '.installed_chaincodes[] | select(.label=="audit-ledger_1.0") | .package_id')
echo "INSTALLED PKGID=[$PKGID]"
if [ -z "$PKGID" ]; then echo "no package id found"; exit 1; fi

docker rm -f peer0org1_audit-ledger_ccaas peer0org2_audit-ledger_ccaas 2>/dev/null || true
docker run -d --name peer0org1_audit-ledger_ccaas --network fabric_test \
  -e CHAINCODE_SERVER_ADDRESS=0.0.0.0:9999 \
  -e CHAINCODE_ID="$PKGID" -e CORE_CHAINCODE_ID_NAME="$PKGID" \
  audit-ledger_ccaas_image:latest >/dev/null
docker run -d --name peer0org2_audit-ledger_ccaas --network fabric_test \
  -e CHAINCODE_SERVER_ADDRESS=0.0.0.0:9999 \
  -e CHAINCODE_ID="$PKGID" -e CORE_CHAINCODE_ID_NAME="$PKGID" \
  audit-ledger_ccaas_image:latest >/dev/null

sleep 4
echo "=== running ccaas containers ==="
docker ps --format '{{.Names}}\t{{.Status}}' | grep ccaas || echo "NONE RUNNING"
echo "=== org1 chaincode log ==="
docker logs peer0org1_audit-ledger_ccaas 2>&1 | tail -4

echo "=== invoke RecordBlock ==="
peer chaincode invoke -o localhost:7050 --ordererTLSHostnameOverride orderer.example.com \
  --tls --cafile "$ORDERER_CA" -C auditchannel -n audit-ledger \
  --peerAddresses localhost:7051 --tlsRootCertFiles "$CORE_PEER_TLS_ROOTCERT_FILE" \
  --peerAddresses localhost:9051 --tlsRootCertFiles "$ORG2_CA" \
  -c '{"function":"RecordBlock","Args":["CIRCULAR_RECEIVED","CIR-smoke-1","0xdeadbeef"]}' 2>&1 | tail -2

sleep 2
echo "=== query GetChain ==="
peer chaincode query -C auditchannel -n audit-ledger -c '{"function":"GetChain","Args":[]}'
echo "=== query VerifyChain ==="
peer chaincode query -C auditchannel -n audit-ledger -c '{"function":"VerifyChain","Args":[]}'
