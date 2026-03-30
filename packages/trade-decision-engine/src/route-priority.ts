/**
 * route-priority.ts
 *
 * Defines the canonical Arbitrum route priority order, guards for route
 * eligibility, and a composite score function that ranks candidates.
 *
 * Priority order:
 *   Tier-1: sushi <-> univ3
 *   Tier-2: camelot <-> univ3
 *   Tier-3: camelot <-> sushi
 */

export type ChainName  = "arbitrum" | "base";
export type DexName    = "univ3" | "sushi" | "camelot" | "aerodrome";

export type RouteCandidate = {
  chain:    ChainName;
  tokenIn:  string;
  tokenOut: string;
  dexBuy:   DexName;
  dexSell:  DexName;

  divergenceBps:   number;
  grossProfitUsd:  number;
  netProfitUsd:    number;
  gasUsd:          number;

  minObservedPoolLiquidityUsd?: number;
  minObserved24hVolumeUsd?:     number;
  routeHash?:                   string;
};

// ── Allowsets ────────────────────────────────────────────────────────────────

const ENABLED_CHAINS = new Set<ChainName>(["arbitrum"]);

const ENABLED_PAIRS = new Set([
  "USDC/WETH",
  "WETH/USDC",
]);

const ENABLED_DEXES = new Set<DexName>([
  "univ3",
  "sushi",
  "camelot",
]);

// ── Priority order (index 0 = highest rank) ──────────────────────────────────

const PRIORITY_ORDER = [
  "sushi->univ3:USDC/WETH",
  "univ3->sushi:USDC/WETH",
  "camelot->univ3:USDC/WETH",
  "univ3->camelot:USDC/WETH",
  "sushi->camelot:USDC/WETH",
  "camelot->sushi:USDC/WETH",

  "sushi->univ3:WETH/USDC",
  "univ3->sushi:WETH/USDC",
  "camelot->univ3:WETH/USDC",
  "univ3->camelot:WETH/USDC",
  "sushi->camelot:WETH/USDC",
  "camelot->sushi:WETH/USDC",
] as const;

type PriorityKey = (typeof PRIORITY_ORDER)[number];

// Higher weight = higher priority (12 = best, 1 = lowest in the set)
const PRIORITY_MAP = new Map<string, number>(
  PRIORITY_ORDER.map((key, idx) => [key, PRIORITY_ORDER.length - idx])
);

// ── Guard result type ─────────────────────────────────────────────────────────

export type RouteGuardReason =
  | "CHAIN_DISABLED"
  | "PAIR_DISABLED"
  | "DEX_DISABLED"
  | "SAME_DEX_DISABLED"
  | "ROUTE_NOT_PRIORITIZED";

export type RouteGuardResult =
  | { ok: true }
  | { ok: false; reason: RouteGuardReason; details: Record<string, unknown> };

// ── Helpers ───────────────────────────────────────────────────────────────────

export function getPairKey(tokenIn: string, tokenOut: string): string {
  return `${tokenIn}/${tokenOut}`;
}

export function getRouteKey(candidate: RouteCandidate): string {
  return `${candidate.dexBuy}->${candidate.dexSell}:${getPairKey(candidate.tokenIn, candidate.tokenOut)}`;
}

// ── Guard ─────────────────────────────────────────────────────────────────────

export function guardRouteCandidate(candidate: RouteCandidate): RouteGuardResult {
  if (!ENABLED_CHAINS.has(candidate.chain)) {
    return {
      ok: false,
      reason: "CHAIN_DISABLED",
      details: { chain: candidate.chain },
    };
  }

  const pairKey = getPairKey(candidate.tokenIn, candidate.tokenOut);
  if (!ENABLED_PAIRS.has(pairKey)) {
    return {
      ok: false,
      reason: "PAIR_DISABLED",
      details: { pairKey },
    };
  }

  if (!ENABLED_DEXES.has(candidate.dexBuy) || !ENABLED_DEXES.has(candidate.dexSell)) {
    return {
      ok: false,
      reason: "DEX_DISABLED",
      details: { dexBuy: candidate.dexBuy, dexSell: candidate.dexSell },
    };
  }

  if (candidate.dexBuy === candidate.dexSell) {
    return {
      ok: false,
      reason: "SAME_DEX_DISABLED",
      details: { dexBuy: candidate.dexBuy, dexSell: candidate.dexSell },
    };
  }

  const routeKey = getRouteKey(candidate);
  if (!PRIORITY_MAP.has(routeKey)) {
    return {
      ok: false,
      reason: "ROUTE_NOT_PRIORITIZED",
      details: { routeKey },
    };
  }

  return { ok: true };
}

// ── Scorer ────────────────────────────────────────────────────────────────────

/**
 * Returns a composite numeric score for a route candidate.
 * Higher = better. Only call this after guardRouteCandidate() passes.
 *
 * Weights:
 *   priorityWeight × 2    — canonical tier order (12 → 1)
 *   divergenceBps × 0.03  — observed price divergence signal
 *   grossProfitUsd × 2    — raw positive carry
 *   netProfitUsd × 4      — post-gas signal (most important)
 *   gasUsd × -3           — penalise high-gas routes
 *   liquidityScore × 1.5  — pool depth (capped at 10)
 *   volumeScore × 1.0     — 24h activity (capped at 10)
 */
export function scoreRouteCandidate(candidate: RouteCandidate): number {
  const routeKey      = getRouteKey(candidate);
  const priorityWeight = PRIORITY_MAP.get(routeKey) ?? 0;

  const divergence = candidate.divergenceBps ?? 0;
  const gross      = candidate.grossProfitUsd ?? 0;
  const net        = candidate.netProfitUsd ?? 0;
  const gas        = candidate.gasUsd ?? 0;
  const liq        = candidate.minObservedPoolLiquidityUsd ?? 0;
  const vol        = candidate.minObserved24hVolumeUsd ?? 0;

  const liquidityScore = Math.min(liq / 100_000, 10);
  const volumeScore    = Math.min(vol / 250_000, 10);

  return Number(
    (
      priorityWeight * 2 +
      divergence     * 0.03 +
      gross          * 2 +
      net            * 4 -
      gas            * 3 +
      liquidityScore * 1.5 +
      volumeScore    * 1.0
    ).toFixed(4)
  );
}
