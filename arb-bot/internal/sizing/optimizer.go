package sizing

import (
	"math"
	"sync"
	"time"

	"arb-bot/internal/types"
)

type RouteObservation struct {
	RouteFamily        string
	Chain              types.ChainName
	SizeUSD            float64
	SimulatedNetUSD    float64
	RealizedNetUSD     float64
	Success            bool
	Timestamp          time.Time
}

type RouteModel struct {
	RouteFamily       string             `json:"route_family"`
	Chain             types.ChainName    `json:"chain"`
	Observations      int                `json:"observations"`
	BestKnownSizeUSD  float64            `json:"best_known_size_usd"`
	AvgRealizedNetUSD float64            `json:"avg_realized_net_usd"`
	SuccessRate       float64            `json:"success_rate"`
	LastUpdated       time.Time          `json:"last_updated"`
}

type Optimizer struct {
	mu      sync.RWMutex
	models  map[string]*routeState
}

type routeState struct {
	obs               int
	successes         int
	bestKnownSizeUSD  float64
	bestKnownNetUSD   float64
	sumRealizedNetUSD float64
	lastUpdated       time.Time
}

func NewOptimizer() *Optimizer {
	return &Optimizer{
		models: make(map[string]*routeState),
	}
}

func key(chain types.ChainName, routeFamily string) string {
	return string(chain) + ":" + routeFamily
}

func (o *Optimizer) Observe(obs RouteObservation) {
	o.mu.Lock()
	defer o.mu.Unlock()

	k := key(obs.Chain, obs.RouteFamily)
	rs, ok := o.models[k]
	if !ok {
		rs = &routeState{}
		o.models[k] = rs
	}

	rs.obs++
	if obs.Success {
		rs.successes++
	}
	rs.sumRealizedNetUSD += obs.RealizedNetUSD

	if obs.RealizedNetUSD > rs.bestKnownNetUSD {
		rs.bestKnownNetUSD = obs.RealizedNetUSD
		rs.bestKnownSizeUSD = obs.SizeUSD
	}
	rs.lastUpdated = obs.Timestamp
}

func (o *Optimizer) Suggest(chain types.ChainName, routeFamily string, baseline float64) []float64 {
	o.mu.RLock()
	defer o.mu.RUnlock()

	k := key(chain, routeFamily)
	rs, ok := o.models[k]

	base := baseline
	if ok && rs.bestKnownSizeUSD > 0 {
		base = rs.bestKnownSizeUSD
	}

	candidates := []float64{
		round(base * 0.60),
		round(base * 0.80),
		round(base * 1.00),
		round(base * 1.15),
		round(base * 1.30),
	}

	out := make([]float64, 0, len(candidates))
	seen := map[float64]bool{}
	for _, c := range candidates {
		if c < 500 {
			continue
		}
		if !seen[c] {
			seen[c] = true
			out = append(out, c)
		}
	}
	return out
}

func (o *Optimizer) Snapshot(chain types.ChainName) []RouteModel {
	o.mu.RLock()
	defer o.mu.RUnlock()

	var out []RouteModel
	for k, rs := range o.models {
		_ = k
		successRate := 0.0
		if rs.obs > 0 {
			successRate = float64(rs.successes) / float64(rs.obs)
		}
		avg := 0.0
		if rs.obs > 0 {
			avg = rs.sumRealizedNetUSD / float64(rs.obs)
		}
		out = append(out, RouteModel{
			RouteFamily:       extractRouteFamily(k),
			Chain:             chainFromKey(k),
			Observations:      rs.obs,
			BestKnownSizeUSD:  rs.bestKnownSizeUSD,
			AvgRealizedNetUSD: avg,
			SuccessRate:       successRate,
			LastUpdated:       rs.lastUpdated,
		})
	}
	return filterByChain(out, chain)
}

func round(v float64) float64 {
	return math.Round(v/25.0) * 25.0
}

func extractRouteFamily(k string) string {
	for i := 0; i < len(k); i++ {
		if k[i] == ':' {
			return k[i+1:]
		}
	}
	return k
}

func chainFromKey(k string) types.ChainName {
	for i := 0; i < len(k); i++ {
		if k[i] == ':' {
			return types.ChainName(k[:i])
		}
	}
	return types.ChainName("")
}

func filterByChain(in []RouteModel, chain types.ChainName) []RouteModel {
	out := make([]RouteModel, 0, len(in))
	for _, m := range in {
		if m.Chain == chain {
			out = append(out, m)
		}
	}
	return out
}
