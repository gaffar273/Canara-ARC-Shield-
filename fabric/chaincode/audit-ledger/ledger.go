package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"strings"

	"github.com/hyperledger/fabric-chaincode-go/shim"
	"github.com/hyperledger/fabric-contract-api-go/contractapi"
)

// AuditLedgerContract records the chain-of-custody for ARC Shield circulars as
// hash-linked blocks. Fabric already provides immutability and ordering; the
// prev-hash link is kept so the on-chain data model matches the backend's
// LedgerBlock type and remains independently verifiable.
type AuditLedgerContract struct {
	contractapi.Contract
}

type Block struct {
	Index       int    `json:"index"`
	Timestamp   string `json:"timestamp"`
	Kind        string `json:"kind"`
	RefID       string `json:"refId"`
	PayloadHash string `json:"payloadHash"`
	PrevHash    string `json:"prevHash"`
	Hash        string `json:"hash"`
	// SubmittedBy records the Fabric identity (MSP id + cert fingerprint) that
	// sealed this block. It is NOT part of blockHash material, so the chain
	// stays verifiable against blocks written before identity capture existed.
	SubmittedBy string `json:"submittedBy,omitempty"`
}

// Agent is an on-chain registered actor permitted to seal blocks. The registry
// is the Fabric-native analogue of an agent-identity standard: each agent is a
// Fabric identity (MSP id + cert fingerprint) scoped to the block kinds it may
// record. RecordBlock enforces this scope once any agent is registered.
type Agent struct {
	ID           string   `json:"id"`
	Role         string   `json:"role"`
	MSPID        string   `json:"mspId"`
	CertHash     string   `json:"certHash"`
	AllowedKinds []string `json:"allowedKinds"`
	RegisteredAt string   `json:"registeredAt"`
}

const (
	headKey     = "head"
	genesisPrev = "0x0"
	blockPrefix = "block"
	agentPrefix = "agent"
)

// submitterIdentity returns a stable "MSPID::certfingerprint" string for the
// transaction submitter, used both to stamp blocks and to key the agent registry.
func submitterIdentity(ctx contractapi.TransactionContextInterface) (string, string, string, error) {
	mspID, err := ctx.GetClientIdentity().GetMSPID()
	if err != nil {
		return "", "", "", err
	}
	cert, err := ctx.GetClientIdentity().GetX509Certificate()
	if err != nil {
		return "", "", "", err
	}
	sum := sha256.Sum256(cert.Raw)
	certHash := hex.EncodeToString(sum[:])
	return mspID, certHash, fmt.Sprintf("%s::%s", mspID, certHash), nil
}

func blockHash(b Block) string {
	material := fmt.Sprintf("%d|%s|%s|%s|%s|%s",
		b.Index, b.Timestamp, b.Kind, b.RefID, b.PayloadHash, b.PrevHash)
	sum := sha256.Sum256([]byte(material))
	return "0x" + hex.EncodeToString(sum[:])
}

func (c *AuditLedgerContract) getHead(ctx contractapi.TransactionContextInterface) (*Block, error) {
	raw, err := ctx.GetStub().GetState(headKey)
	if err != nil {
		return nil, err
	}
	if raw == nil {
		return nil, nil
	}
	var head Block
	if err := json.Unmarshal(raw, &head); err != nil {
		return nil, err
	}
	return &head, nil
}

// RecordBlock appends one hash-linked block. The timestamp is taken from the
// transaction (deterministic across endorsers); time.Now() must never be used.
//
// Identity & policy: the submitter's Fabric identity is stamped on the block.
// If an agent registry exists, the submitter must be a registered agent whose
// allowedKinds permit this block kind — otherwise the transaction is rejected.
// When no agents are registered the ledger is permissive (open mode), so an
// existing deployment keeps working until agents are explicitly registered.
func (c *AuditLedgerContract) RecordBlock(
	ctx contractapi.TransactionContextInterface,
	kind string, refID string, payloadHash string,
) (*Block, error) {
	ts, err := ctx.GetStub().GetTxTimestamp()
	if err != nil {
		return nil, err
	}

	_, _, submittedBy, err := submitterIdentity(ctx)
	if err != nil {
		return nil, err
	}
	if err := c.authorize(ctx, submittedBy, kind); err != nil {
		return nil, err
	}

	head, err := c.getHead(ctx)
	if err != nil {
		return nil, err
	}

	index := 0
	prevHash := genesisPrev
	if head != nil {
		index = head.Index + 1
		prevHash = head.Hash
	}

	block := Block{
		Index:       index,
		Timestamp:   ts.AsTime().UTC().Format("2006-01-02T15:04:05.000Z"),
		Kind:        kind,
		RefID:       refID,
		PayloadHash: payloadHash,
		PrevHash:    prevHash,
	}
	block.Hash = blockHash(block)
	block.SubmittedBy = submittedBy

	raw, err := json.Marshal(block)
	if err != nil {
		return nil, err
	}

	key, err := ctx.GetStub().CreateCompositeKey(blockPrefix, []string{strconv.Itoa(index)})
	if err != nil {
		return nil, err
	}
	if err := ctx.GetStub().PutState(key, raw); err != nil {
		return nil, err
	}
	if err := ctx.GetStub().PutState(headKey, raw); err != nil {
		return nil, err
	}
	return &block, nil
}

// authorize enforces the agent registry. Open mode (no agents registered) is
// permissive so existing deployments keep working. Once any agent exists, the
// submitter must be registered and the block kind must be in its allowedKinds.
func (c *AuditLedgerContract) authorize(
	ctx contractapi.TransactionContextInterface, submittedBy string, kind string,
) error {
	agents, err := c.listAgents(ctx)
	if err != nil {
		return err
	}
	if len(agents) == 0 {
		return nil // open mode: no registry yet
	}
	for _, a := range agents {
		if fmt.Sprintf("%s::%s", a.MSPID, a.CertHash) != submittedBy {
			continue
		}
		if len(a.AllowedKinds) == 0 {
			return nil // registered with no kind restriction
		}
		for _, k := range a.AllowedKinds {
			if k == kind || k == "*" {
				return nil
			}
		}
		return fmt.Errorf("agent %q is not permitted to record block kind %q", a.ID, kind)
	}
	return fmt.Errorf("submitter %q is not a registered agent", submittedBy)
}

// RegisterAgent records (or updates) an agent bound to the SUBMITTER's Fabric
// identity, scoped to the block kinds it may seal. The agent is keyed by the
// caller's identity, so an actor can only enroll itself — its MSP id and cert
// fingerprint are taken from the transaction, never from arguments.
func (c *AuditLedgerContract) RegisterAgent(
	ctx contractapi.TransactionContextInterface,
	id string, role string, allowedKindsCSV string,
) (*Agent, error) {
	ts, err := ctx.GetStub().GetTxTimestamp()
	if err != nil {
		return nil, err
	}
	mspID, certHash, _, err := submitterIdentity(ctx)
	if err != nil {
		return nil, err
	}
	allowed := []string{}
	for _, k := range strings.Split(allowedKindsCSV, ",") {
		if s := strings.TrimSpace(k); s != "" {
			allowed = append(allowed, s)
		}
	}
	agent := Agent{
		ID:           id,
		Role:         role,
		MSPID:        mspID,
		CertHash:     certHash,
		AllowedKinds: allowed,
		RegisteredAt: ts.AsTime().UTC().Format("2006-01-02T15:04:05.000Z"),
	}
	raw, err := json.Marshal(agent)
	if err != nil {
		return nil, err
	}
	key, err := ctx.GetStub().CreateCompositeKey(agentPrefix, []string{mspID, certHash})
	if err != nil {
		return nil, err
	}
	if err := ctx.GetStub().PutState(key, raw); err != nil {
		return nil, err
	}
	return &agent, nil
}

func (c *AuditLedgerContract) listAgents(ctx contractapi.TransactionContextInterface) ([]Agent, error) {
	iter, err := ctx.GetStub().GetStateByPartialCompositeKey(agentPrefix, []string{})
	if err != nil {
		return nil, err
	}
	defer iter.Close()

	agents := []Agent{}
	for iter.HasNext() {
		kv, err := iter.Next()
		if err != nil {
			return nil, err
		}
		var a Agent
		if err := json.Unmarshal(kv.Value, &a); err != nil {
			return nil, err
		}
		agents = append(agents, a)
	}
	return agents, nil
}

// ListAgents returns the on-chain agent registry.
func (c *AuditLedgerContract) ListAgents(ctx contractapi.TransactionContextInterface) ([]Agent, error) {
	return c.listAgents(ctx)
}

func (c *AuditLedgerContract) allBlocks(ctx contractapi.TransactionContextInterface) ([]Block, error) {
	iter, err := ctx.GetStub().GetStateByPartialCompositeKey(blockPrefix, []string{})
	if err != nil {
		return nil, err
	}
	defer iter.Close()

	blocks := []Block{}
	for iter.HasNext() {
		kv, err := iter.Next()
		if err != nil {
			return nil, err
		}
		var b Block
		if err := json.Unmarshal(kv.Value, &b); err != nil {
			return nil, err
		}
		blocks = append(blocks, b)
	}
	// Composite-key iteration returns lexical order; sort by index for chain order.
	for i := 1; i < len(blocks); i++ {
		for j := i; j > 0 && blocks[j-1].Index > blocks[j].Index; j-- {
			blocks[j-1], blocks[j] = blocks[j], blocks[j-1]
		}
	}
	return blocks, nil
}

func (c *AuditLedgerContract) GetChain(ctx contractapi.TransactionContextInterface) ([]Block, error) {
	return c.allBlocks(ctx)
}

func (c *AuditLedgerContract) GetByRef(
	ctx contractapi.TransactionContextInterface, refID string,
) ([]Block, error) {
	all, err := c.allBlocks(ctx)
	if err != nil {
		return nil, err
	}
	out := []Block{}
	for _, b := range all {
		if b.RefID == refID {
			out = append(out, b)
		}
	}
	return out, nil
}

type VerifyResult struct {
	Valid bool `json:"valid"`
	// BrokenAt is the index of the first broken block, or -1 when the chain is
	// valid. (contractapi metadata does not support *int, so -1 signals "none".)
	BrokenAt int `json:"brokenAt"`
}

func (c *AuditLedgerContract) VerifyChain(
	ctx contractapi.TransactionContextInterface,
) (*VerifyResult, error) {
	all, err := c.allBlocks(ctx)
	if err != nil {
		return nil, err
	}
	prevHash := genesisPrev
	for _, b := range all {
		recomputed := blockHash(Block{
			Index: b.Index, Timestamp: b.Timestamp, Kind: b.Kind,
			RefID: b.RefID, PayloadHash: b.PayloadHash, PrevHash: b.PrevHash,
		})
		if b.PrevHash != prevHash || recomputed != b.Hash {
			return &VerifyResult{Valid: false, BrokenAt: b.Index}, nil
		}
		prevHash = b.Hash
	}
	return &VerifyResult{Valid: true, BrokenAt: -1}, nil
}

func main() {
	contract, err := contractapi.NewChaincode(&AuditLedgerContract{})
	if err != nil {
		panic(fmt.Sprintf("create audit-ledger chaincode: %v", err))
	}

	// Chaincode-as-a-Service: when the peer expects an external chaincode
	// service, it sets CHAINCODE_SERVER_ADDRESS and CHAINCODE_ID. We then run
	// as a gRPC server the peer dials, instead of being built into an image by
	// the peer (which the legacy builder can't do on recent Docker versions).
	address := os.Getenv("CHAINCODE_SERVER_ADDRESS")
	if address != "" {
		server := &shim.ChaincodeServer{
			CCID:    os.Getenv("CHAINCODE_ID"),
			Address: address,
			CC:      contract,
			TLSProps: shim.TLSProperties{
				Disabled: true,
			},
		}
		if err := server.Start(); err != nil {
			panic(fmt.Sprintf("start audit-ledger chaincode server: %v", err))
		}
		return
	}

	if err := contract.Start(); err != nil {
		panic(fmt.Sprintf("start audit-ledger chaincode: %v", err))
	}
}
