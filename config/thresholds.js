function num(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

const THRESHOLDS = {
  pollIntervalMs: num('POLL_INTERVAL_MS', 3000),
  divergenceThresholdBps: num('DIVERGENCE_THRESHOLD_BPS', 20),
  slippageBps: num('SLIPPAGE_BPS', 30),
  minGrossProfitUsd: num('MIN_GROSS_PROFIT_USD', 1.5),
  minNetProfitUsd: num('MIN_NET_PROFIT_USD', 1.0),
  maxGasToGrossRatio: num('MAX_GAS_TO_GROSS_RATIO', 0.5),
  tradeUsdHint: num('TRADE_USD_HINT', 250),
  gasUnitsApprox: num('GAS_UNITS_APPROX', 260000),
  routeDeadlineSeconds: num('ROUTE_DEADLINE_SECONDS', 45),
  safeMode: String(process.env.SAFE_MODE || 'true').toLowerCase() === 'true',
  activeChains: String(process.env.ACTIVE_CHAINS || 'polygon')
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean)
};

module.exports = {
  THRESHOLDS
};
