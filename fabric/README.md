# ARC Shield — Trust Layer (Hyperledger Fabric)

The backend's Trust Layer records each circular's chain-of-custody as hash-linked
blocks. There are two interchangeable backends behind one `LedgerBackend` interface
(`backend/src/store/ledger/`):

- **hash-chain** (default) — local append-only SHA-256 chain. Zero infra.
- **fabric** — real Hyperledger Fabric. Selected by `FABRIC_ENABLED=true`.

The backend code never changes between them; only env does.

## Layout

```
fabric/
  chaincode/audit-ledger/   Go smart contract (RecordBlock/GetChain/GetByRef/VerifyChain/RegisterAgent/ListAgents)
  scripts/
    up.sh                   download fabric-samples, boot 2-org test-network, deploy chaincode
    down.sh                 tear the network down
    print-connection.sh     emit backend/.env lines for Org1 connection material
  fabric-samples/           downloaded by up.sh (gitignored, ~1.5GB)
```

## Prerequisites

- Docker + Docker Compose running (Linux containers).
- **Go** on PATH (the `deployCC -ccl go` step vendors chaincode deps on the host).
- **Run on Linux / macOS / WSL2.** The official test-network is supported there.
  On native Windows git-bash, `network.sh`'s Docker volume mounts can fail on path
  translation — use WSL2.

## Bring it up

```bash
bash fabric/scripts/up.sh                 # boots network + deploys chaincode
bash fabric/scripts/print-connection.sh   # prints the FABRIC_* env lines
# paste those lines into backend/.env (they set FABRIC_ENABLED=true + cert paths)
```

Then run the backend either on the host (`npm run dev`) or in its container joined
to the Fabric network:

```bash
docker compose up --build backend
```

`docker-compose.yml` joins the external `fabric_test` network the test-network
creates, and reaches the peer by its container hostname (`peer0.org1.example.com`).

## How it maps to the chaincode

| Backend call | Chaincode tx | Type |
|---|---|---|
| `ledgerBackend.append(...)` | `RecordBlock(kind, refId, payloadHash)` | submit (ordered) |
| `ledgerBackend.all()` | `GetChain()` | evaluate |
| `ledgerBackend.forRef(id)` | `GetByRef(refId)` | evaluate |
| `ledgerBackend.verifyChain()` | `VerifyChain()` | evaluate |
| `ledgerBackend.registerAgent(...)` | `RegisterAgent(id, role, allowedKindsCSV)` | submit (ordered) |
| `ledgerBackend.listAgents()` | `ListAgents()` | evaluate |

Block timestamps come from the transaction (`GetTxTimestamp`), never `time.Now()`,
so endorsements are deterministic.

## Agent identity & policy enforcement

Fabric-native, no Ethereum/ERC needed. Every `RecordBlock` captures the submitter's
Fabric identity — `MSPID::sha256(cert)` — and stamps it on the block (`submittedBy`),
giving cryptographic proof of *which* identity sealed each custody event. The field
is outside the `blockHash` material, so blocks written before this existed still
verify.

`RegisterAgent` maintains an on-chain registry keyed by the caller's own identity
(MSP id + cert fingerprint are read from the transaction, never trusted from args —
an actor can only enroll itself), scoping each agent to the block kinds it may seal.
`RecordBlock` then enforces it:

- **Open mode** — no agents registered: any identity may seal (back-compat default).
- **Enforced mode** — once any agent exists: the submitter must be a registered agent
  whose `allowedKinds` permit the kind, else the transaction is rejected.

Today the backend seals with a single Org1 user cert, so per-node *distinct* certs
require enrolling more identities via the Fabric CA — the chaincode already supports
it; the enrollment is the remaining infra step.

## Tear down

```bash
bash fabric/scripts/down.sh
```
