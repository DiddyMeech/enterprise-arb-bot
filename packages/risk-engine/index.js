const { THRESHOLDS } = require('../../config/thresholds');

function evaluateRoute(route) {
  const reasons = [];

  if (!route) {
    return {
      ok: false,
      reasons: ['NO_ROUTE']
    };
  }

  if (!Array.isArray(route.legs) || route.legs.length < 2) {
    reasons.push('INVALID_LEGS');
  }

  if (Number(route.grossProfitUsd) < THRESHOLDS.minGrossProfitUsd) {
    reasons.push('LOW_GROSS_PROFIT');
  }

  if (Number(route.netProfitUsd) < THRESHOLDS.minNetProfitUsd) {
    reasons.push('LOW_NET_PROFIT');
  }

  if (Number(route.grossProfitUsd) <= 0) {
    reasons.push('NO_GROSS_EDGE');
  }

  if (
    Number(route.grossProfitUsd) > 0 &&
    Number(route.gasUsd) / Number(route.grossProfitUsd) > THRESHOLDS.maxGasToGrossRatio
  ) {
    reasons.push('GAS_DOMINATES');
  }

  for (const leg of route.legs || []) {
    if (!leg.router) reasons.push('MISSING_ROUTER');
    if (!leg.tokenIn) reasons.push('MISSING_TOKEN_IN');
    if (!leg.tokenOut) reasons.push('MISSING_TOKEN_OUT');
    if (!leg.amountInRaw) reasons.push('MISSING_AMOUNT_IN');
    if (!leg.minOutRaw) reasons.push('MISSING_MIN_OUT');
  }

  return {
    ok: reasons.length === 0,
    reasons
  };
}

function pickBestRoute(routes) {
  if (!Array.isArray(routes) || !routes.length) return null;
  return [...routes].sort((a, b) => Number(b.netProfitUsd) - Number(a.netProfitUsd))[0];
}

module.exports = {
  evaluateRoute,
  pickBestRoute
};
