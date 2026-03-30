require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const { ethers } = require('ethers');
const { randomUUID } = require('crypto');
const { getChain, makeProvider, getToken } = require('../../config/chains');
const { THRESHOLDS } = require('../../config/thresholds');
const { getOptimalQuote } = require('../../packages/quote-engine');
const { evaluateRoute } = require('../../packages/risk-engine');

const dedupeCache = new Map();
const DEDUPE_TTL_MS = 5000;

function cleanupDedupe() {
  const now = Date.now();
  for (const [key, ts] of dedupeCache.entries()) {
    if (now - ts > DEDUPE_TTL_MS) {
      dedupeCache.delete(key);
    }
  }
}

function isDuplicate(key) {
  cleanupDedupe();
  if (dedupeCache.has(key)) return true;
  dedupeCache.set(key, Date.now());
  return false;
}

function detectDirectionFromRoute(route) {
  if (!route || !route.legs || route.legs.length < 2) {
    return {
      dexBuy: 'unknown',
      dexSell: 'unknown'
    };
  }

  return {
    dexBuy: route.legs[0].dex,
    dexSell: route.legs[1].dex
  };
}

function normalizeOpportunity({ chainKey, route, nativeTokenUsd }) {
  const direction = detectDirectionFromRoute(route);

  return {
    id: randomUUID(),
    ts: Date.now(),
    chain: chainKey,
    pair: `${route.tokenInSymbol}/${route.tokenOutSymbol}`,
    tokenIn: route.tokenInSymbol,
    tokenOut: route.tokenOutSymbol,
    tokenInAddress: route.tokenIn,
    tokenOutAddress: route.tokenOut,
    dexBuy: direction.dexBuy,
    dexSell: direction.dexSell,
    amountInRaw: route.amountInRaw,
    expectedAmountOutRaw: route.expectedAmountOutRaw,
    grossProfitTokenRaw: route.grossProfitTokenRaw,
    quotedGrossProfitUsd: route.grossProfitUsd,
    estimatedGasUsd: route.gasUsd,
    dexFeesUsd: route.dexFeesUsd,
    netProfitUsd: route.netProfitUsd,
    nativeTokenUsd,
    routePlan: {
      chain: route.chain,
      tokenIn: route.tokenIn,
      tokenOut: route.tokenOut,
      amountInRaw: route.amountInRaw,
      expectedAmountOutRaw: route.expectedAmountOutRaw,
      minProfitTokenRaw: '1',
      deadline: route.deadline,
      legs: route.legs
    }
  };
}

function logOpportunity(opp) {
  console.log('\n=== CROSS-DEX ARB SCANNER ===');
  console.log(`Chain:     ${opp.chain}`);
  console.log(`Pair:      ${opp.pair}`);
  console.log(`Buy Dex:   ${opp.dexBuy}`);
  console.log(`Sell Dex:  ${opp.dexSell}`);
  console.log(`Gross USD: ${opp.quotedGrossProfitUsd.toFixed(6)}`);
  console.log(`Gas USD:   ${opp.estimatedGasUsd.toFixed(6)}`);
  console.log(`DEX Fees:  ${opp.dexFeesUsd.toFixed(6)}`);
  console.log(`Net USD:   ${opp.netProfitUsd.toFixed(6)}`);
  console.log(
    `Leg 1:     ${opp.routePlan.legs[0].dex} ${opp.routePlan.legs[0].amountInRaw} -> ${opp.routePlan.legs[0].expectedOutRaw}`
  );
  console.log(
    `Leg 2:     ${opp.routePlan.legs[1].dex} ${opp.routePlan.legs[1].amountInRaw} -> ${opp.routePlan.legs[1].expectedOutRaw}`
  );
}

const { buildExecutionPlan } = require('../../packages/execution-engine');

async function submitOpportunity(opp) {
  if (THRESHOLDS.safeMode) {
    console.log(`[SAFE_MODE] Would execute: ${opp.id} | net=$${opp.netProfitUsd.toFixed(4)}`);
    return;
  }

  try {
    const provider = makeProvider(opp.chain);
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
    const executorAddress = process.env.ARB_CONTRACT_ADDRESS || getChain(opp.chain).executorAddress;

    if (!executorAddress) {
      console.error('[EXEC] No executor address configured — set ARB_CONTRACT_ADDRESS in .env');
      return;
    }

    const plan = buildExecutionPlan({ executorAddress, route: opp.routePlan });

    console.log(`[EXEC] Sending tx | id=${opp.id} | net=$${opp.netProfitUsd.toFixed(4)}`);

    const tx = await wallet.sendTransaction({
      to: plan.target,
      data: plan.calldata,
      gasLimit: plan.gasLimit
    });

    console.log(`[EXEC] TX HASH: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`[EXEC] ${receipt.status === 1 ? 'SUCCESS ✅' : 'REVERTED ❌'} block=${receipt.blockNumber}`);
  } catch (err) {
    console.error('[EXEC ERROR]', err.message);
  }
}


async function scanChain({ chainKey, nativeTokenUsd }) {
  try {
    const chain = getChain(chainKey);
    const provider = makeProvider(chainKey);

    const quote = await getOptimalQuote({
      chainKey,
      provider,
      tokenInSymbol: 'USDC',
      tokenOutSymbol: 'WETH',
      amountInUsd: THRESHOLDS.tradeUsdHint,
      nativeTokenUsd
    });

    if (!quote.ok || !quote.bestRoute) {
      return;
    }

    const evaluation = evaluateRoute(quote.bestRoute);
    if (!evaluation.ok) {
      return;
    }

    const route = quote.bestRoute;
    const direction = detectDirectionFromRoute(route);

    const dedupeKey = [
      chain.key,
      route.tokenInSymbol,
      route.tokenOutSymbol,
      direction.dexBuy,
      direction.dexSell,
      route.amountInRaw,
      route.expectedAmountOutRaw
    ].join(':');

    if (isDuplicate(dedupeKey)) {
      return;
    }

    const opp = normalizeOpportunity({
      chainKey,
      route,
      nativeTokenUsd
    });

    logOpportunity(opp);
    await submitOpportunity(opp);
  } catch (error) {
    console.error(`[scanner:${chainKey}]`, error.message);
  }
}

async function main() {
  const activeChains = THRESHOLDS.activeChains.length
    ? THRESHOLDS.activeChains
    : ['arbitrum'];

  const nativeTokenUsd = Number(process.env.ETH_PRICE_USD_HINT || '2200');

  console.log('[scanner] activeChains=', activeChains.join(','));
  console.log('[scanner] pollIntervalMs=', THRESHOLDS.pollIntervalMs);
  console.log('[scanner] tradeUsdHint=', THRESHOLDS.tradeUsdHint);
  console.log('[scanner] safeMode=', THRESHOLDS.safeMode);

  for (const chainKey of activeChains) {
    try {
      getChain(chainKey);
    } catch (err) {
      console.error(`[scanner] skipping unsupported chain ${chainKey}`);
    }
  }

  const tick = async () => {
    for (const chainKey of activeChains) {
      await scanChain({ chainKey, nativeTokenUsd });
    }
  };

  await tick();
  setInterval(tick, THRESHOLDS.pollIntervalMs);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[scanner] fatal', err);
    process.exit(1);
  });
}

module.exports = {
  scanChain,
  normalizeOpportunity
};
