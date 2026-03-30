const { buildTwoLegRoutes } = require('../route-engine');
const { evaluateRoute, pickBestRoute } = require('../risk-engine');

async function getOptimalQuote({
  chainKey,
  provider,
  tokenInSymbol = 'USDC',
  tokenOutSymbol = 'WETH',
  amountInUsd,
  nativeTokenUsd
}) {
  const routes = await buildTwoLegRoutes({
    chainKey,
    provider,
    tokenInSymbol,
    tokenOutSymbol,
    amountInUsd,
    nativeTokenUsd
  });

  if (!routes.length) {
    return {
      ok: false,
      reason: 'NO_ROUTES',
      routes: [],
      bestRoute: null
    };
  }

  const bestRoute = pickBestRoute(routes);
  const evaluation = evaluateRoute(bestRoute);

  if (!evaluation.ok) {
    return {
      ok: false,
      reason: evaluation.reasons.join(','),
      routes,
      bestRoute
    };
  }

  return {
    ok: true,
    routes,
    bestRoute
  };
}

module.exports = {
  getOptimalQuote
};
