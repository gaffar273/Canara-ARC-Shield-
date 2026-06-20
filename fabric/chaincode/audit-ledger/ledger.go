package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"strconv"

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
}

const (
	headKey     = "head"
	genesisPrev = "0x0"
	blockPrefix = "block"
)

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
func (c *AuditLedgerContract) RecordBlock(
	ctx contractapi.TransactionContextInterface,
	kind string, refID string, payloadHash string,
) (*Block, error) {
	ts, err := ctx.GetStub().GetTxTimestamp()
	if err != nil {
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
