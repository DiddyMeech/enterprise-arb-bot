'use strict';
const { ethers } = require('ethers');
const { getChain, getToken, getDex } = require('../../config/chains');
const { THRESHOLDS } = require('../../config/thresholds');
const { SushiAdapter } = require('../dex-adapters/sushi');
const { QuickSwapAdapter } = require('../dex-adapters/quickswap');
const { UniV3Adapter } = require('../dex-adapters/univ3');

function bn(v) {
  return ethers.BigNumber.from(v);
}

function applySlippage(rawAmount, slippageBps = THRESHOLDS.slippageBps) {
  return bn(rawAmount).mul(10000 - slippageBps).div(10000);
}

function formatUnitsSafe(raw, decimals) {
  return Number(ethers.utils.formatUnits(raw, decimals));
}

function estimateGasUsd({ gasPriceWei, gasUnits = THRESHOLDS.gasUnitsApprox, nativeTokenUsd }) {
  const gasCostEth = Number(ethers.utils.formatEther(bn(gasPriceWei).mul(gasUnits)));
  return gasCostEth * Number(nativeTokenUsd);
}

function makeAdapters(chainKey, provider) {
  const chain = getChain(chainKey);
  const adapters = [];

  // Sushi V2 (always)
  try {
    adapters.push(new SushiAdapter({ chainKey, provider }));
  } catch {}

  // QuickSwap V2 (if configured)
  try {
    getDex(chainKey, 'quickswap');
    adapters.push(new QuickSwapAdapter({ chainKey, provider }));
  } catch {}

  // Uniswap V3 500 fee (if enabled)
  if (String(process.env.ENABLE_UNIV3 || 'true').toLowerCase() === 'true') {
    try {
      adapters.push(new UniV3Adapter({ chainKey, provider, feeTier: 500 }));
    } catch {}
    // 3000 fee tier — off by default (slower, less liquidity on Polygon)
    if (String(process.env.ENABLE_UNIV3_3000 || 'false').toLowerCase() === 'true') {
      try {
        adapters.push(new UniV3Adapter({ chainKey, provider, feeTier: 3000 }));
      } catch {}
    }
  }

  return adapters;
}

async function getGasPriceWei(provider) {
  const feeData = await provider.getFeeData();
  if (feeData.gasPrice) return feeData.gasPrice.toString();
  if (feeData.maxFeePerGas) return feeData.maxFeePerGas.toString();
  throw new Error('NO_GAS_PRICE');
}

// Build candidate pairs from available token symbols
function buildPairs(chainKey) {
  const chain = getChain(chainKey);
  const symbols = Object.keys(chain.tokens);
  const wanted = [
    ['USDC', 'WETH'],
    ['USDC', 'WMATIC'],
    ['WETH', 'WMATIC'],
    ['USDC_BRIDGED', 'WETH'],
    ['USDC_BRIDGED', 'WMATIC'],
  ];
  return wanted.filter(([a, b]) => chain.tokens[a] && chain.tokens[b]);
}

async function buildTwoLegRoutes({
  chainKey,
  provider,
  tokenInSymbol,
  tokenOutSymbol,
  amountInUsd,
  nativeTokenUsd
}) {
  const gasPriceWei = await getGasPriceWei(provider);
  const gasUsd = estimateGasUsd({
    gasPriceWei,
    gasUnits: THRESHOLDS.gasUnitsApprox,
    nativeTokenUsd
  });

  const chain = getChain(chainKey);
  const adapters = makeAdapters(chainKey, provider);
  const candidates = [];

  // Determine which pairs to scan
  const pairsToScan = tokenInSymbol && tokenOutSymbol
    ? [[tokenInSymbol, tokenOutSymbol]]
    : buildPairs(chainKey);

  // Single size from env — no multi-size probing unless MULTI_SIZE_PROBE=true
  const multiSize = String(process.env.MULTI_SIZE_PROBE || 'false').toLowerCase() === 'true';
  const sizesToProbe = amountInUsd
    ? [amountInUsd]
    : multiSize
      ? [5, 25, 100, 500]
      : [Number(process.env.TRADE_USD_HINT || 500)];

  for (const [inSym, outSym] of pairsToScan) {
    let tokenIn, tokenOut;
    try {
      tokenIn = getToken(chainKey, inSym);
      tokenOut = getToken(chainKey, outSym);
    } catch {
      continue;
    }

    for (const usdSize of sizesToProbe) {
      const amountInRaw = ethers.utils.parseUnits(String(usdSize), tokenIn.decimals);

      for (const buyAdapter of adapters) {
        let leg1;
        try {
          leg1 = await buyAdapter.quoteExactIn({
            tokenIn: tokenIn.address,
            tokenOut: tokenOut.address,
            amountInRaw
          });
        } catch {
          continue;
        }

        for (const sellAdapter of adapters) {
          if (buyAdapter.name === sellAdapter.name &&
              buyAdapter.fee === sellAdapter.fee) continue;

          let leg2;
          try {
            leg2 = await sellAdapter.quoteExactIn({
              tokenIn: tokenOut.address,
              tokenOut: tokenIn.address,
              amountInRaw: leg1.amountOutRaw
            });
          } catch {
            continue;
          }

          const grossProfitTokenRaw = bn(leg2.amountOutRaw).sub(amountInRaw);
          const grossProfitUsd = formatUnitsSafe(grossProfitTokenRaw, tokenIn.decimals);
          const dexFeesUsd = usdSize * ((buyAdapter.feeBps + sellAdapter.feeBps) / 10000);
          const netProfitUsd = grossProfitUsd - dexFeesUsd - gasUsd;

          candidates.push({
            chain: chain.key,
            tokenIn: tokenIn.address,
            tokenOut: tokenOut.address,
            tokenInSymbol: tokenIn.symbol,
            tokenOutSymbol: tokenOut.symbol,
            amountInRaw: amountInRaw.toString(),
            expectedAmountOutRaw: leg2.amountOutRaw,
            grossProfitTokenRaw: grossProfitTokenRaw.toString(),
            grossProfitUsd,
            gasUsd,
            dexFeesUsd,
            netProfitUsd,
            gasPriceWei: String(gasPriceWei),
            deadline: Math.floor(Date.now() / 1000) + THRESHOLDS.routeDeadlineSeconds,
            minProfitTokenRaw: '1',
            legs: [
              {
                dex: leg1.dex,
                kind: leg1.kind,
                router: leg1.router,
                tokenIn: leg1.tokenIn,
                tokenOut: leg1.tokenOut,
                amountInRaw: leg1.amountInRaw,
                expectedOutRaw: leg1.amountOutRaw,
                minOutRaw: applySlippage(leg1.amountOutRaw).toString(),
                feeBps: leg1.feeBps,
                fee: leg1.fee || 0
              },
              {
                dex: leg2.dex,
                kind: leg2.kind,
                router: leg2.router,
                tokenIn: leg2.tokenIn,
                tokenOut: leg2.tokenOut,
                amountInRaw: leg2.amountInRaw,
                expectedOutRaw: leg2.amountOutRaw,
                minOutRaw: applySlippage(leg2.amountOutRaw).toString(),
                feeBps: leg2.feeBps,
                fee: leg2.fee || 0
              }
            ]
          });
        }
      }
    }
  }

  return candidates.sort((a, b) => b.netProfitUsd - a.netProfitUsd);
}

module.exports = {
  applySlippage,
  buildTwoLegRoutes,
  estimateGasUsd
};
