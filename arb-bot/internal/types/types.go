package types

import "time"

type ChainName string

const (
	ChainArbitrum ChainName = "arbitrum"
	ChainBase     ChainName = "base"
)

type ExecutionMode string

const (
	ModeWallet ExecutionMode = "wallet"
	ModeFlash  ExecutionMode = "flash"
)

type Opportunity struct {
	ID                        string
	Chain                     ChainName
	TokenIn                   string
	TokenOut                  string
	DexBuy                    string
	DexSell                   string
	QuotedGrossProfitUSD      float64
	EstimatedGasUSD           float64
	EstimatedPriceImpactBps   float64
	MinObservedPoolLiquidity  float64
	MinObserved24hVolume      float64
	BlockNumberSeen           uint64
	CurrentBlockNumber        uint64
	QuoteTimestamp            time.Time
	RouteFamily               string
}

type EvaluationResult struct {
	OpportunityID string
	Chain         ChainName
	Mode          ExecutionMode
	Score         float64
	BestSizeUSD   float64
	NetProfitUSD  float64
	RouteFamily   string
}

type FailureReason string

const (
	FailUnknown                FailureReason = "UNKNOWN"
	FailTooLateToSend          FailureReason = "TOO_LATE_TO_SEND"
	FailRouteQuarantined       FailureReason = "ROUTE_QUARANTINED"
	FailNotProfitable          FailureReason = "NOT_PROFITABLE_AFTER_FEES"
	FailSimReverted            FailureReason = "REVERTED_OR_IMPOSSIBLE"
	FailInsufficientOutput     FailureReason = "INSUFFICIENT_OUTPUT_AMOUNT"
	FailCallback               FailureReason = "CALLBACK_FAILED"
	FailAssetNotReturned       FailureReason = "ASSET_NOT_RETURNED"
	FailTransferFailed         FailureReason = "TRANSFER_FAILED"
	FailRPC                    FailureReason = "RPC_ERROR"
	FailGasEstimationFailed    FailureReason = "GAS_ESTIMATION_FAILED"
)

type ReplayRecord struct {
	Timestamp   time.Time              `json:"timestamp"`
	Phase       string                 `json:"phase"`
	Opportunity Opportunity            `json:"opportunity"`
	Evaluation  *EvaluationResult      `json:"evaluation,omitempty"`
	Failure     FailureReason          `json:"failure,omitempty"`
	Details     map[string]interface{} `json:"details,omitempty"`
}

type ProviderResult struct {
	ProviderName string
	Chain        ChainName
	LatencyMS    float64
	Success      bool
	Stale        bool
	SendSuccess  bool
	UsedForSend  bool
	Timestamp    time.Time
}
