/**
 * opportunity-prefilter.ts
 *
 * Structured pre-filter that runs before simulation.
 * Rejects junk opportunities early with explicit reason codes.
 */

import { PREFILTER_CONFIG } from './prefilter-config';

export type OpportunityInput = {
  id: string;
  chain: string;
  tokenIn: string;
  tokenOut: string;
  dexBuy: string;
  dexSell: string;

  estimatedPriceImpactBps?: number;   // divergenceBps
  quotedGrossProfitUsd?: number;       // grossProfitUsd
  estimatedGasUsd?: number;            // gasUsd
  netProfitUsd?: number;

  minObservedPoolLiquidityUsd?: number;
  minObserved24hVolumeUsd?: number;

  quoteTimestampMs?: number;
  nowMs?: number;

  routeHash?: string;
};

export type SkipReason =
  | 'CHAIN_NOT_ALLOWED'
  | 'PAIR_NOT_ALLOWED'
  | 'DEX_COMBO_NOT_ALLOWED'
  | 'SAME_DEX_ROUTE'
  | 'STALE_QUOTE'
  | 'LOW_DIVERGENCE'
  | 'LOW_GROSS_PROFIT'
  | 'LOW_NET_PROFIT'
  | 'GAS_DOMINATES_PROFIT'
  | 'LOW_POOL_LIQUIDITY'
  | 'LOW_24H_VOLUME';

export type PrefilterResult =
  | { ok: true; score: number }
  | { ok: false; reason: SkipReason; details: Record<string, unknown> };

function computeScore(args: {
  divergenceBps: number;
  grossProfitUsd: number;
  netProfitUsd: number;
  gasUsd: number;
}): number {
  return parseFloat(
    (
      args.divergenceBps * 0.02 +
      args.grossProfitUsd * 2 +
      args.netProfitUsd * 3 -
      args.gasUsd * 3
    ).toFixed(4)
  );
}

export function prefilterOpportunity(opp: OpportunityInput): PrefilterResult {
  const pair     = `${opp.tokenIn}/${opp.tokenOut}`;
  const dexCombo = `${opp.dexBuy}->${opp.dexSell}`;

  const divergenceBps  = opp.estimatedPriceImpactBps ?? 0;
  const grossProfitUsd = opp.quotedGrossProfitUsd ?? 0;
  const gasUsd         = opp.estimatedGasUsd ?? 0;
  const netProfitUsd   = opp.netProfitUsd ?? (grossProfitUsd - gasUsd);
  const liquidityUsd   = opp.minObservedPoolLiquidityUsd ?? 0;
  const volumeUsd      = opp.minObserved24hVolumeUsd ?? 0;

  const nowMs           = opp.nowMs ?? Date.now();
  const quoteTimestamp  = opp.quoteTimestampMs ?? nowMs;
  const ageMs           = nowMs - quoteTimestamp;

  // 1. Chain allowlist
  if (!(PREFILTER_CONFIG.ENABLED_CHAINS as readonly string[]).includes(opp.chain)) {
    return { ok: false, reason: 'CHAIN_NOT_ALLOWED', details: { chain: opp.chain } };
  }

  // 2. Pair allowlist
  if (!PREFILTER_CONFIG.ALLOWED_PAIRS.has(pair as any)) {
    return { ok: false, reason: 'PAIR_NOT_ALLOWED', details: { pair } };
  }

  // 3. DEX combo allowlist
  if (!PREFILTER_CONFIG.ALLOWED_DEX_COMBOS.has(dexCombo as any)) {
    return { ok: false, reason: 'DEX_COMBO_NOT_ALLOWED', details: { dexCombo } };
  }

  // 4. Same-DEX guard
  if (PREFILTER_CONFIG.DISABLE_SAME_DEX_ARB && opp.dexBuy === opp.dexSell) {
    return { ok: false, reason: 'SAME_DEX_ROUTE', details: { dexBuy: opp.dexBuy, dexSell: opp.dexSell } };
  }

  // 5. Quote freshness
  if (ageMs > PREFILTER_CONFIG.MAX_QUOTE_AGE_MS) {
    return { ok: false, reason: 'STALE_QUOTE', details: { ageMs, maxAgeMs: PREFILTER_CONFIG.MAX_QUOTE_AGE_MS } };
  }

  // 6. Divergence floor
  if (divergenceBps < PREFILTER_CONFIG.MIN_DIVERGENCE_BPS) {
    return {
      ok: false, reason: 'LOW_DIVERGENCE',
      details: { divergenceBps, minRequired: PREFILTER_CONFIG.MIN_DIVERGENCE_BPS },
    };
  }

  // 7. Gross profit floor
  if (grossProfitUsd < PREFILTER_CONFIG.MIN_GROSS_PROFIT_USD) {
    return {
      ok: false, reason: 'LOW_GROSS_PROFIT',
      details: { grossProfitUsd, minRequired: PREFILTER_CONFIG.MIN_GROSS_PROFIT_USD },
    };
  }

  // 8. Net profit floor
  if (netProfitUsd < PREFILTER_CONFIG.MIN_NET_PROFIT_USD) {
    return {
      ok: false, reason: 'LOW_NET_PROFIT',
      details: { netProfitUsd, minRequired: PREFILTER_CONFIG.MIN_NET_PROFIT_USD },
    };
  }

  // 9. Gas dominates guard
  if (grossProfitUsd > 0 && gasUsd > grossProfitUsd * PREFILTER_CONFIG.MAX_GAS_TO_GROSS_RATIO) {
    return {
      ok: false, reason: 'GAS_DOMINATES_PROFIT',
      details: { gasUsd, grossProfitUsd, ratio: gasUsd / grossProfitUsd, maxRatio: PREFILTER_CONFIG.MAX_GAS_TO_GROSS_RATIO },
    };
  }

  // 10. Liquidity floor
  if (liquidityUsd > 0 && liquidityUsd < PREFILTER_CONFIG.MIN_POOL_LIQUIDITY_USD) {
    return {
      ok: false, reason: 'LOW_POOL_LIQUIDITY',
      details: { liquidityUsd, minRequired: PREFILTER_CONFIG.MIN_POOL_LIQUIDITY_USD },
    };
  }

  // 11. Volume floor
  if (volumeUsd > 0 && volumeUsd < PREFILTER_CONFIG.MIN_24H_VOLUME_USD) {
    return {
      ok: false, reason: 'LOW_24H_VOLUME',
      details: { volumeUsd, minRequired: PREFILTER_CONFIG.MIN_24H_VOLUME_USD },
    };
  }

  return {
    ok: true,
    score: computeScore({ divergenceBps, grossProfitUsd, netProfitUsd, gasUsd }),
  };
}
