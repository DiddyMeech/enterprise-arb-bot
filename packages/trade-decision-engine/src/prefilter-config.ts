/**
 * prefilter-config.ts
 * Centralised filter constants for the opportunity pre-filter.
 */

export const PREFILTER_CONFIG = {
  ENABLED_CHAINS: ['arbitrum'] as const,

  ALLOWED_PAIRS: new Set([
    'USDC/WETH',
    'WETH/USDC',
  ]),

  ALLOWED_DEX_COMBOS: new Set([
    'sushi->univ3',
    'univ3->sushi',
  ]),

  DISABLE_SAME_DEX_ARB: true,

  MIN_DIVERGENCE_BPS: 100,
  MIN_GROSS_PROFIT_USD: 0.50,
  MIN_NET_PROFIT_USD: 0.25,

  MAX_GAS_TO_GROSS_RATIO: 0.50,
  MAX_QUOTE_AGE_MS: 1200,

  MIN_POOL_LIQUIDITY_USD: 100_000,
  MIN_24H_VOLUME_USD: 250_000,

  LOG_SKIPS: true,
} as const;
