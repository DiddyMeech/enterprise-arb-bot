require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const { makeProvider, getChain } = require('../../config/chains');
const { getOptimalQuote } = require('../../packages/quote-engine');
const { evaluateRoute } = require('../../packages/risk-engine');
const { buildExecutionPlan } = require('../../packages/execution-engine');

async function simulate({ chainKey, amountInUsd, nativeTokenUsd }) {
  const provider = makeProvider(chainKey);
  const chain = getChain(chainKey);

  const quote = await getOptimalQuote({
    chainKey,
    provider,
    amountInUsd,
    nativeTokenUsd
  });

  if (!quote.ok || !quote.bestRoute) {
    return { ok: false, reason: 'NO_ROUTE' };
  }

  const route = quote.bestRoute;

  const evaluation = evaluateRoute(route);
  if (!evaluation.ok) {
    return { ok: false, reason: evaluation.reasons.join(',') };
  }

  const executionPlan = buildExecutionPlan({
    executorAddress: chain.executorAddress,
    route
  });

  try {
    await provider.call({
      to: executionPlan.target,
      data: executionPlan.calldata
    });

    return {
      ok: true,
      route
    };
  } catch (err) {
    return {
      ok: false,
      reason: err.message
    };
  }
}

module.exports = {
  simulate
};
