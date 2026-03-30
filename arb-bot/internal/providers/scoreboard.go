package providers

import (
	"math"
	"sort"
	"sync"
	"time"

	"arb-bot/internal/types"
)

type ProviderStats struct {
	Name             string            `json:"name"`
	Chain            types.ChainName   `json:"chain"`
	Samples          int               `json:"samples"`
	P50LatencyMS     float64           `json:"p50_latency_ms"`
	P95LatencyMS     float64           `json:"p95_latency_ms"`
	SuccessRate      float64           `json:"success_rate"`
	StaleRate        float64           `json:"stale_rate"`
	SendSuccessRate  float64           `json:"send_success_rate"`
	LastUpdated      time.Time         `json:"last_updated"`
	Score            float64           `json:"score"`
}

type providerWindow struct {
	results []types.ProviderResult
}

type Scoreboard struct {
	mu         sync.RWMutex
	maxSamples int
	data       map[string]*providerWindow
}

func NewScoreboard(maxSamples int) *Scoreboard {
	if maxSamples <= 0 {
		maxSamples = 200
	}
	return &Scoreboard{
		maxSamples: maxSamples,
		data:       make(map[string]*providerWindow),
	}
}

func (s *Scoreboard) key(chain types.ChainName, provider string) string {
	return string(chain) + ":" + provider
}

func (s *Scoreboard) Record(res types.ProviderResult) {
	s.mu.Lock()
	defer s.mu.Unlock()

	k := s.key(res.Chain, res.ProviderName)
	pw, ok := s.data[k]
	if !ok {
		pw = &providerWindow{}
		s.data[k] = pw
	}
	pw.results = append(pw.results, res)
	if len(pw.results) > s.maxSamples {
		pw.results = pw.results[len(pw.results)-s.maxSamples:]
	}
}

func (s *Scoreboard) BestProvider(chain types.ChainName) (string, ProviderStats, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var best ProviderStats
	var bestName string
	found := false

	for k, pw := range s.data {
		if len(pw.results) == 0 {
			continue
		}
		if pw.results[0].Chain != chain {
			continue
		}
		stats := computeStats(pw.results)
		if !found || stats.Score > best.Score {
			found = true
			best = stats
			bestName = stats.Name
		}
		_ = k
	}

	return bestName, best, found
}

func (s *Scoreboard) Snapshot(chain types.ChainName) []ProviderStats {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var out []ProviderStats
	for _, pw := range s.data {
		if len(pw.results) == 0 || pw.results[0].Chain != chain {
			continue
		}
		out = append(out, computeStats(pw.results))
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Score > out[j].Score })
	return out
}

func computeStats(results []types.ProviderResult) ProviderStats {
	latencies := make([]float64, 0, len(results))
	successes := 0
	stales := 0
	sendAttempts := 0
	sendSuccesses := 0

	name := results[len(results)-1].ProviderName
	chain := results[len(results)-1].Chain
	last := results[len(results)-1].Timestamp

	for _, r := range results {
		latencies = append(latencies, r.LatencyMS)
		if r.Success {
			successes++
		}
		if r.Stale {
			stales++
		}
		if r.UsedForSend {
			sendAttempts++
			if r.SendSuccess {
				sendSuccesses++
			}
		}
	}

	sort.Float64s(latencies)
	p50 := percentile(latencies, 50)
	p95 := percentile(latencies, 95)
	successRate := ratio(successes, len(results))
	staleRate := ratio(stales, len(results))
	sendSuccessRate := ratio(sendSuccesses, sendAttempts)

	// Higher is better.
	score := 0.0
	score += (successRate * 50.0)
	score += (sendSuccessRate * 30.0)
	score -= (staleRate * 40.0)
	score -= math.Min(p50/10.0, 20.0)
	score -= math.Min(p95/20.0, 20.0)

	return ProviderStats{
		Name:            name,
		Chain:           chain,
		Samples:         len(results),
		P50LatencyMS:    p50,
		P95LatencyMS:    p95,
		SuccessRate:     successRate,
		StaleRate:       staleRate,
		SendSuccessRate: sendSuccessRate,
		LastUpdated:     last,
		Score:           score,
	}
}

func percentile(xs []float64, p float64) float64 {
	if len(xs) == 0 {
		return 0
	}
	if len(xs) == 1 {
		return xs[0]
	}
	pos := (p / 100.0) * float64(len(xs)-1)
	l := int(math.Floor(pos))
	u := int(math.Ceil(pos))
	if l == u {
		return xs[l]
	}
	weight := pos - float64(l)
	return xs[l]*(1.0-weight) + xs[u]*weight
}

func ratio(a, b int) float64 {
	if b == 0 {
		return 0
	}
	return float64(a) / float64(b)
}
