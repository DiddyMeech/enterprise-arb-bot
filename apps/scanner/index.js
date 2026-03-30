require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const { randomUUID } = require('crypto');
const { getChain } = require('../../config/chains');
const { THRESHOLDS } = require('../../config/thresholds');
const { getOptimalQuote } = require('../../packages/quote-engine');
const { evaluateRoute } = require('../../packages/risk-engine');
const { RpcManager } = require('../../packages/rpc-manager');

const dedupeCache = new Map();
const DEDUPE_TTL_MS = 5000;

function cleanupDedupe() {
  const now = Date.now();
  for (const [key, ts] of dedupeCache.entries()) {
    if (now - ts > DEDUPE_TTL_MS) dedupeCache.delete(key);
  }
}

function isDuplicate(key) {
  cleanupDedupe();
  if (dedupeCache.has(key)) return true;
  dedupeCache.set(key, Date.now());
  return false;
}

function detectDirectionFromRoute(route) {
  return {
    dexBuy: route?.legs?.[0]?.dex || 'unknown',
    dexSell: route?.legs?.[1]?.dex || 'unknown'
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
      minProfitTokenRaw: route.minProfitTokenRaw || '1',
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
  console.log(`Gross USD: ${Number(opp.quotedGrossProfitUsd).toFixed(6)}`);
  console.log(`Gas USD:   ${Number(opp.estimatedGasUsd).toFixed(6)}`);
  console.log(`DEX Fees:  ${Number(opp.dexFeesUsd).toFixed(6)}`);
  console.log(`Net USD:   ${Number(opp.netProfitUsd).toFixed(6)}`);
  console.log(`RPC Lane:  quote`);
}

async function submitOpportunity(opp) {
  console.log(`[shadow] submitOpportunity ${opp.id}`);
}

async function scanChain({ chainKey, nativeTokenUsd }) {
  try {
    const chain = getChain(chainKey);
    const rpcManager = RpcManager.fromEnv(chainKey);

    const quote = await rpcManager.withProvider('quote', async (provider) => {
      return getOptimalQuote({
        chainKey,
        provider,
        tokenInSymbol: 'USDC',
        tokenOutSymbol: 'WETH',
        amountInUsd: THRESHOLDS.tradeUsdHint,
        nativeTokenUsd
      });
    });

    if (!quote.ok || !quote.bestRoute) return;

    const evaluation = evaluateRoute(quote.bestRoute);
    if (!evaluation.ok) return;

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

    if (isDuplicate(dedupeKey)) return;

    const opp = normalizeOpportunity({ chainKey, route, nativeTokenUsd });

    logOpportunity(opp);
    await submitOpportunity(opp);

    const stats = rpcManager.stats().filter((s) => s.lane === 'quote');
    console.log('[scanner.rpc.stats]', JSON.stringify(stats));
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

module.exports = { scanChain, normalizeOpportunity };
