require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const { getChain } = require('../../config/chains');
const { getOptimalQuote } = require('../../packages/quote-engine');
const { evaluateRoute } = require('../../packages/risk-engine');
const {
  buildExecutionPlan,
  buildFlashExecutionPlan
} = require('../../packages/execution-engine');
const { RpcManager } = require('../../packages/rpc-manager');

async function simulate({ chainKey, amountInUsd, nativeTokenUsd }) {
  const chain = getChain(chainKey);
  const rpcManager = RpcManager.fromEnv(chainKey);
  const useFlashMode =
    String(process.env.FLASH_LOAN_ENABLED || 'false').toLowerCase() === 'true';

  // Get a bare provider without the withProvider timeout cap
  // (multi-venue route scanning needs more than 4500ms for ~240 quote calls)
  const provider = await rpcManager.getProvider('sim', 5000);

  let quote;
  try {
    quote = await getOptimalQuote({
      chainKey,
      provider,
      amountInUsd,
      nativeTokenUsd
    });
  } catch (err) {
    return { ok: false, reason: `QUOTE_ERROR: ${err.message}` };
  }

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
          chain.flashExecutorAddress ||
          process.env.POLYGON_FLASH_EXECUTOR_ADDRESS ||
          process.env.ARB_FLASH_EXECUTOR_ADDRESS,
        route
      })
    : buildExecutionPlan({
        executorAddress:
          chain.executorAddress || process.env.ARB_CONTRACT_ADDRESS,
        route
      });

  // Only the eth_call simulation goes through withProvider
  try {
    await rpcManager.withProvider('sim', async (simProvider) => {
      await simProvider.call({
        to: executionPlan.target,
        data: executionPlan.calldata
      });
    }, 12000);

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
}

if (require.main === module) {
  (async () => {
    const chainKey = process.env.ACTIVE_DEPLOY_CHAIN || 'polygon';
    const nativeTokenUsd = Number(process.env.ETH_PRICE_USD_HINT || '2200');
    
    // Check multiple sizes for thin margins
    const sizes = [5, 10, 25, 50, 100];
    let bestResult = { ok: false, reason: 'NO_ROUTE' };

    for (const size of sizes) {
      console.log(`[simulator] trying trade size: $${size}`);
      const result = await simulate({ chainKey, amountInUsd: size, nativeTokenUsd });
      if (result.ok) {
        bestResult = result;
        break;
      }
    }

    console.log(JSON.stringify(bestResult, null, 2));
    process.exit(bestResult.ok ? 0 : 1);
  })().catch((err) => {
    console.error('[simulator] fatal', err);
    process.exit(1);
  });
}

module.exports = {
  simulate
};
