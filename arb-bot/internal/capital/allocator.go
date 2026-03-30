package capital

import (
	"errors"
	"fmt"
	"sync"

	"arb-bot/internal/types"
)

var (
	ErrChainCapExceeded      = errors.New("chain capital cap exceeded")
	ErrRouteFamilyCapExceeded = errors.New("route family capital cap exceeded")
	ErrGlobalCapExceeded     = errors.New("global capital cap exceeded")
)

type Config struct {
	GlobalMaxUSD           float64
	MaxPerChainUSD         map[types.ChainName]float64
	MaxPerRouteFamilyUSD   float64
	MaxConcurrentPositions int
}

type Reservation struct {
	ID          string
	Chain       types.ChainName
	RouteFamily string
	AmountUSD   float64
}

type Allocator struct {
	mu                sync.Mutex
	cfg               Config
	globalUsedUSD     float64
	chainUsedUSD      map[types.ChainName]float64
	routeFamilyUsed   map[string]float64
	activeReservations map[string]Reservation
}

func NewAllocator(cfg Config) *Allocator {
	return &Allocator{
		cfg:                cfg,
		chainUsedUSD:       make(map[types.ChainName]float64),
		routeFamilyUsed:    make(map[string]float64),
		activeReservations: make(map[string]Reservation),
	}
}

func (a *Allocator) Reserve(id string, chain types.ChainName, routeFamily string, amountUSD float64) error {
	a.mu.Lock()
	defer a.mu.Unlock()

	if a.cfg.MaxConcurrentPositions > 0 && len(a.activeReservations) >= a.cfg.MaxConcurrentPositions {
		return fmt.Errorf("max concurrent positions reached: %d", a.cfg.MaxConcurrentPositions)
	}

	if a.globalUsedUSD+amountUSD > a.cfg.GlobalMaxUSD {
		return ErrGlobalCapExceeded
	}

	chainCap, ok := a.cfg.MaxPerChainUSD[chain]
	if ok && a.chainUsedUSD[chain]+amountUSD > chainCap {
		return ErrChainCapExceeded
	}

	if a.cfg.MaxPerRouteFamilyUSD > 0 && a.routeFamilyUsed[routeFamily]+amountUSD > a.cfg.MaxPerRouteFamilyUSD {
		return ErrRouteFamilyCapExceeded
	}

	a.globalUsedUSD += amountUSD
	a.chainUsedUSD[chain] += amountUSD
	a.routeFamilyUsed[routeFamily] += amountUSD
	a.activeReservations[id] = Reservation{
		ID:          id,
		Chain:       chain,
		RouteFamily: routeFamily,
		AmountUSD:   amountUSD,
	}
	return nil
}

func (a *Allocator) Release(id string) {
	a.mu.Lock()
	defer a.mu.Unlock()

	r, ok := a.activeReservations[id]
	if !ok {
		return
	}

	a.globalUsedUSD -= r.AmountUSD
	a.chainUsedUSD[r.Chain] -= r.AmountUSD
	a.routeFamilyUsed[r.RouteFamily] -= r.AmountUSD
	delete(a.activeReservations, id)
}

func (a *Allocator) Snapshot() map[string]interface{} {
	a.mu.Lock()
	defer a.mu.Unlock()

	out := map[string]interface{}{
		"global_used_usd":      a.globalUsedUSD,
		"chain_used_usd":       copyChainMap(a.chainUsedUSD),
		"route_family_used_usd": copyRouteMap(a.routeFamilyUsed),
		"active_count":         len(a.activeReservations),
	}
	return out
}

func copyChainMap(in map[types.ChainName]float64) map[string]float64 {
	out := make(map[string]float64, len(in))
	for k, v := range in {
		out[string(k)] = v
	}
	return out
}

func copyRouteMap(in map[string]float64) map[string]float64 {
	out := make(map[string]float64, len(in))
	for k, v := range in {
		out[k] = v
	}
	return out
}
