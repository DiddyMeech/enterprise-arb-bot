/**
 * live-enable-gate.ts
 *
 * Evaluates whether a specific live trade candidate is allowed to execute.
 *
 * Two-stage check:
 *   1. Route-family eligibility — derived from shadow stats (route-level history)
 *   2. Per-candidate check      — score and net profit at send time
 *
 * Consumers:
 *   - ArbOrchestrator.sendAndTrack()  (wired inline)
 *   - Any future executor that calls sendExecution()
 */

import { LIVE_GATE_CONFIG } from "./live-gate-config";
import { routeFamilyKey } from "./route-family-key";

// ── Types ─────────────────────────────────────────────────────────────────────

export type RankedShadowRoute = {
  routeFamily:       string;
  seen:              number;
  prefilterPassRate: number;
  simPassRate:       number;
  wouldExecRate:     number;
  avgDivergenceBps:  number;
  avgGrossProfitUsd: number;
  avgNetProfitUsd:   number;
  avgGasUsd:         number;
  rankScore:         number;
};

export type LiveCandidate = {
  chain:          string;
  tokenIn:        string;
  tokenOut:       string;
  dexBuy:         string;
  dexSell:        string;
  routeHash?:     string;
  priorityScore?: number;
  netProfitUsd?:  number;
};

export type LiveGateResult =
  | { ok: true;  reason: "LIVE_ALLOWED";          details: Record<string, unknown> }
  | { ok: false; reason: string;                   details: Record<string, unknown> };

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * From the full shadow ranking, return only the families that meet every
 * quality threshold, capped at TOP_N_ROUTE_FAMILIES.
 */
export function getEligibleLiveRouteFamilies(
  ranked: RankedShadowRoute[],
): RankedShadowRoute[] {
  return ranked
    .filter((r) => r.seen              >= LIVE_GATE_CONFIG.MIN_SHADOW_SEEN)
    .filter((r) => r.prefilterPassRate >= LIVE_GATE_CONFIG.MIN_PREFILTER_PASS_RATE)
    .filter((r) => r.simPassRate       >= LIVE_GATE_CONFIG.MIN_SIM_PASS_RATE)
    .filter((r) => r.wouldExecRate     >= LIVE_GATE_CONFIG.MIN_WOULD_EXEC_RATE)
    .filter((r) => r.avgNetProfitUsd   >= LIVE_GATE_CONFIG.MIN_AVG_NET_PROFIT_USD)
    .filter((r) => r.avgGasUsd         <= LIVE_GATE_CONFIG.MAX_AVG_GAS_USD)
    .slice(0, LIVE_GATE_CONFIG.TOP_N_ROUTE_FAMILIES);
}

// ── Gate ─────────────────────────────────────────────────────────────────────

/**
 * Returns { ok: true } only when all conditions pass.
 * Call this immediately before sendExecution() in live mode.
 *
 * @param candidate         - the live trade we want to send
 * @param rankedShadowRoutes - output of ShadowRouteTracker.ranked()
 */
export function evaluateLiveEnablement(input: {
  candidate:          LiveCandidate;
  rankedShadowRoutes: RankedShadowRoute[];
}): LiveGateResult {
  const { candidate, rankedShadowRoutes } = input;

  // Master kill-switch
  if (!LIVE_GATE_CONFIG.ENABLED) {
    return { ok: false, reason: "LIVE_GATE_DISABLED", details: {} };
  }

  // Chain guard
  if (LIVE_GATE_CONFIG.REQUIRE_ARBITRUM_ONLY && candidate.chain !== "arbitrum") {
    return {
      ok: false,
      reason: "LIVE_GATE_CHAIN_BLOCKED",
      details: { chain: candidate.chain },
    };
  }

  // Same-DEX guard
  if (LIVE_GATE_CONFIG.REQUIRE_CROSS_DEX && candidate.dexBuy === candidate.dexSell) {
    return {
      ok: false,
      reason: "LIVE_GATE_SAME_DEX_BLOCKED",
      details: { dexBuy: candidate.dexBuy, dexSell: candidate.dexSell },
    };
  }

  // Route-family eligibility from shadow history
  const family   = routeFamilyKey(candidate);
  const eligible = getEligibleLiveRouteFamilies(rankedShadowRoutes);
  const eligibleFamilies = eligible.map((r) => r.routeFamily);

  if (!eligibleFamilies.includes(family)) {
    return {
      ok: false,
      reason: "LIVE_GATE_ROUTE_NOT_ELIGIBLE",
      details: { routeFamily: family, eligibleFamilies },
    };
  }

  // Per-candidate score gate
  const score = candidate.priorityScore ?? 0;
  if (score < LIVE_GATE_CONFIG.MIN_LIVE_SCORE) {
    return {
      ok: false,
      reason: "LIVE_GATE_LOW_SCORE",
      details: { routeFamily: family, priorityScore: score, minRequired: LIVE_GATE_CONFIG.MIN_LIVE_SCORE },
    };
  }

  // Per-candidate net profit gate
  const net = candidate.netProfitUsd ?? 0;
  if (net < LIVE_GATE_CONFIG.MIN_LIVE_NET_PROFIT_USD) {
    return {
      ok: false,
      reason: "LIVE_GATE_LOW_NET_PROFIT",
      details: { routeFamily: family, netProfitUsd: net, minRequired: LIVE_GATE_CONFIG.MIN_LIVE_NET_PROFIT_USD },
    };
  }

  return {
    ok: true,
    reason: "LIVE_ALLOWED",
    details: { routeFamily: family, priorityScore: score, netProfitUsd: net, eligibleFamilies },
  };
}
