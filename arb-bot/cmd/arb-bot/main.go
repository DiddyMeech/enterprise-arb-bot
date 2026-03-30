package main

import (
	"encoding/json"
	"fmt"
	"time"

	"arb-bot/internal/capital"
	"arb-bot/internal/providers"
	"arb-bot/internal/replay"
	"arb-bot/internal/sizing"
	"arb-bot/internal/types"
)

func main() {
	allocator := capital.NewAllocator(capital.Config{
		GlobalMaxUSD: 50000,
		MaxPerChainUSD: map[types.ChainName]float64{
			types.ChainArbitrum: 25000,
			types.ChainBase:     25000,
		},
		MaxPerRouteFamilyUSD:   10000,
		MaxConcurrentPositions: 8,
	})

	replayStore := replay.NewStore("./replays", 3)
	scoreboard := providers.NewScoreboard(200)
	optimizer := sizing.NewOptimizer()

	opp := types.Opportunity{
		ID:                       "arb-001",
		Chain:                    types.ChainArbitrum,
		TokenIn:                  "WETH",
		TokenOut:                 "USDC",
		DexBuy:                   "univ3",
		DexSell:                  "sushi",
		QuotedGrossProfitUSD:     42.0,
		EstimatedGasUSD:          1.8,
		EstimatedPriceImpactBps:  12.0,
		MinObservedPoolLiquidity: 450000,
		MinObserved24hVolume:     1200000,
		BlockNumberSeen:          100,
		CurrentBlockNumber:       101,
		QuoteTimestamp:           time.Now(),
		RouteFamily:              "arbitrum:WETH-USDC:univ3-sushi",
	}

	// Provider stats
	scoreboard.Record(types.ProviderResult{
		ProviderName: "hot-rpc-a",
		Chain:        types.ChainArbitrum,
		LatencyMS:    88,
		Success:      true,
		Stale:        false,
		UsedForSend:  true,
		SendSuccess:  true,
		Timestamp:    time.Now(),
	})
	scoreboard.Record(types.ProviderResult{
		ProviderName: "hot-rpc-b",
		Chain:        types.ChainArbitrum,
		LatencyMS:    142,
		Success:      true,
		Stale:        false,
		UsedForSend:  false,
		SendSuccess:  false,
		Timestamp:    time.Now(),
	})

	bestProvider, stats, ok := scoreboard.BestProvider(types.ChainArbitrum)
	if ok {
		fmt.Println("best provider:", bestProvider)
		printJSON(stats)
	}

	// Adaptive sizing
	for _, size := range []float64{2500, 4000, 5500} {
		optimizer.Observe(sizing.RouteObservation{
			RouteFamily:     opp.RouteFamily,
			Chain:           opp.Chain,
			SizeUSD:         size,
			SimulatedNetUSD: size * 0.003,
			RealizedNetUSD:  size * 0.0022,
			Success:         true,
			Timestamp:       time.Now(),
		})
	}

	suggested := optimizer.Suggest(opp.Chain, opp.RouteFamily, 5000)
	fmt.Println("suggested sizes:", suggested)

	// Capital reservation
	chosenSize := suggested[len(suggested)/2]
	if err := allocator.Reserve(opp.ID, opp.Chain, opp.RouteFamily, chosenSize); err != nil {
		fmt.Println("reserve failed:", err)
	} else {
		fmt.Println("reserve ok:", chosenSize)
	}

	// Replay record
	rec := types.ReplayRecord{
		Timestamp:   time.Now().UTC(),
		Phase:       "simulate",
		Opportunity: opp,
		Evaluation: &types.EvaluationResult{
			OpportunityID: opp.ID,
			Chain:         opp.Chain,
			Mode:          types.ModeWallet,
			Score:         48.5,
			BestSizeUSD:   chosenSize,
			NetProfitUSD:  26.2,
			RouteFamily:   opp.RouteFamily,
		},
		Details: map[string]interface{}{
			"provider": bestProvider,
			"p50_ms":   stats.P50LatencyMS,
		},
	}
	if err := replayStore.Save(rec); err != nil {
		fmt.Println("replay save failed:", err)
	}

	// Complete position and release capital
	allocator.Release(opp.ID)

	if err := replayStore.Flush(); err != nil {
		fmt.Println("replay flush failed:", err)
	}

	printJSON(allocator.Snapshot())
	printJSON(scoreboard.Snapshot(types.ChainArbitrum))
	printJSON(optimizer.Snapshot(types.ChainArbitrum))
}

func printJSON(v interface{}) {
	b, _ := json.MarshalIndent(v, "", "  ")
	fmt.Println(string(b))
}
