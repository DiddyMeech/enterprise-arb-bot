/**
 * prefilter-config.ts
 * Centralised filter constants for the opportunity pre-filter.
 *
 * Set PREFILTER_DEBUG=1 in .env for looser thresholds (debug/visibility mode).
 * Leave unset for production-strict mode.
 */

const DEBUG_MODE = process.env.PREFILTER_DEBUG === '1';

export const PREFILTER_CONFIG = {
  ENABLED_CHAINS: ['arbitrum'] as const,

  ALLOWED_PAIRS: new Set([
    'USDC/WETH',
    'WETH/USDC',
  ]),

  ALLOWED_DEX_COMBOS: new Set([
    'sushi->univ3',
    'univ3->sushi',
    // Tier-2: Camelot ↔ UniV3  (enabled once CAMELOT_ENABLED=true + valid router)
    'camelot->univ3',
    'univ3->camelot',
    // Tier-3: Camelot ↔ Sushi  (enabled last, lower priority)
    'sushi->camelot',
    'camelot->sushi',
  ]),

  DISABLE_SAME_DEX_ARB: true,

  // ── Thresholds (debug=loose, production=strict) ──────────────────────────
  MIN_DIVERGENCE_BPS:    DEBUG_MODE ? 60   : 100,
  MIN_GROSS_PROFIT_USD:  DEBUG_MODE ? 0.25 : 0.50,
  MIN_NET_PROFIT_USD:    DEBUG_MODE ? 0.10 : 0.25,
  MAX_GAS_TO_GROSS_RATIO: DEBUG_MODE ? 0.6  : 0.50,
  MAX_QUOTE_AGE_MS:      1200,

  MIN_POOL_LIQUIDITY_USD: 100_000,
  MIN_24H_VOLUME_USD:     250_000,

  LOG_SKIPS: true,
  DEBUG_MODE,
} as const;
