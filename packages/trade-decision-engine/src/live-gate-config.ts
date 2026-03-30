/**
 * live-gate-config.ts
 *
 * Thresholds that control when a route family is eligible for live trading.
 *
 * ALL conditions must pass before a candidate is allowed through to sendAndTrack().
 * Set ENABLED=false to bypass the gate entirely (not recommended for production).
 *
 * Shadow stats requirements (route-family level):
 *   MIN_SHADOW_SEEN           — minimum observations needed before we trust the stats
 *   MIN_PREFILTER_PASS_RATE   — fraction of seen that cleared prefilter
 *   MIN_SIM_PASS_RATE         — fraction of prefilter-passed that cleared simulation
 *   MIN_WOULD_EXEC_RATE       — fraction of seen that would have been sent (strongest signal)
 *   MIN_AVG_NET_PROFIT_USD    — shadow average net must be positive and meaningful
 *   MAX_AVG_GAS_USD           — gate out gas-heavy route families
 *
 * Per-candidate requirements (checked at send time):
 *   MIN_LIVE_SCORE            — output of scoreRouteCandidate()
 *   MIN_LIVE_NET_PROFIT_USD   — must exceed the prefilter net floor, not just equal it
 *
 * Safety flags:
 *   TOP_N_ROUTE_FAMILIES      — only the top-N ranked families can trade live (start: 1)
 *   REQUIRE_CROSS_DEX         — blocks same-DEX routes
 *   REQUIRE_ARBITRUM_ONLY     — blocks Base and any future chains until proven
 */

export const LIVE_GATE_CONFIG = {
  ENABLED: true,

  // Shadow quality bar (route-family level)
  TOP_N_ROUTE_FAMILIES:    1,
  MIN_SHADOW_SEEN:         5,
  MIN_PREFILTER_PASS_RATE: 0.10,
  MIN_SIM_PASS_RATE:       0.40,
  MIN_WOULD_EXEC_RATE:     0.02,
  MIN_AVG_NET_PROFIT_USD:  0.10,
  MAX_AVG_GAS_USD:         0.10,

  // Per-candidate constraints at send time
  MIN_LIVE_SCORE:          1.0,
  MIN_LIVE_NET_PROFIT_USD: 0.25,

  // Safety flags
  REQUIRE_CROSS_DEX:       true,
  REQUIRE_ARBITRUM_ONLY:   true,
} as const;
