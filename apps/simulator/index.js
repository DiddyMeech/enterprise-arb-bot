require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const { getChain } = require('../../config/chains');
const { getOptimalQuote } = require('../../packages/quote-engine');
const { evaluateRoute } = require('../../packages/risk-engine');
const { buildExecutionPlan, buildFlashExecutionPlan } = require('../../packages/execution-engine');
const { RpcManager } = require('../../packages/rpc-manager');

async function simulate({ chainKey, amountInUsd, nativeTokenUsd }) {
  const chain = getChain(chainKey);
  const rpcManager = RpcManager.fromEnv(chainKey);
  const useFlashMode =
    String(process.env.FLASH_LOAN_ENABLED || 'false').toLowerCase() === 'true';

  return rpcManager.withProvider('sim', async (provider) => {
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

    const executionPlan = useFlashMode
      ? buildFlashExecutionPlan({
          flashExecutorAddress:
            chain.flashExecutorAddress || process.env.ARB_FLASH_EXECUTOR_ADDRESS,
          route
        })
      : buildExecutionPlan({
          executorAddress:
            chain.executorAddress || process.env.ARB_CONTRACT_ADDRESS,
          route
        });

    try {
      await provider.call({
        to: executionPlan.target,
        data: executionPlan.calldata
      });

      return {
        ok: true,
        mode: useFlashMode ? 'flash' : 'standard',
        route
      };
    } catch (err) {
      return {
        ok: false,
        mode: useFlashMode ? 'flash' : 'standard',
        reason: err.message
      };
    }
  });
}

module.exports = { simulate };
