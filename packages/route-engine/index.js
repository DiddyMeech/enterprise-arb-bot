const { ethers } = require('ethers');
const { getChain, getToken } = require('../../config/chains');
const { THRESHOLDS } = require('../../config/thresholds');
const { SushiAdapter } = require('../dex-adapters/sushi');
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

function estimateGasUsd({
  gasPriceWei,
  gasUnits = THRESHOLDS.gasUnitsApprox,
  nativeTokenUsd
}) {
  const gasCostEth = Number(ethers.utils.formatEther(
    bn(gasPriceWei).mul(gasUnits)
  ));
  return gasCostEth * Number(nativeTokenUsd);
}

function makeAdapters(chainKey, provider) {
  // UniV3 disabled until contract supports V3 swap path
  return [
    new SushiAdapter({ chainKey, provider })
  ];
}

async function getGasPriceWei(provider) {
  const feeData = await provider.getFeeData();
  if (feeData.gasPrice) return feeData.gasPrice.toString();
  if (feeData.maxFeePerGas) return feeData.maxFeePerGas.toString();
  throw new Error('NO_GAS_PRICE');
}

async function buildTwoLegRoutes({
  chainKey,
  provider,
  tokenInSymbol = 'USDC',
  tokenOutSymbol = 'WETH',
  amountInUsd,
  nativeTokenUsd
}) {
  const chain = getChain(chainKey);
  const tokenIn = getToken(chainKey, tokenInSymbol);
  const tokenOut = getToken(chainKey, tokenOutSymbol);

  if (tokenIn.symbol !== 'USDC') {
    throw new Error('Current builder expects tokenInSymbol=USDC');
  }

  const amountInRaw = ethers.utils.parseUnits(
    String(amountInUsd),
    tokenIn.decimals
  );

  const gasPriceWei = await getGasPriceWei(provider);
  const gasUsd = estimateGasUsd({
    gasPriceWei,
    gasUnits: THRESHOLDS.gasUnitsApprox,
    nativeTokenUsd
  });

  const adapters = makeAdapters(chainKey, provider);
  const candidates = [];

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
      const grossProfitUsd = formatUnitsSafe(
        grossProfitTokenRaw,
        tokenIn.decimals
      );

      const dexFeesUsd =
        Number(amountInUsd) * ((buyAdapter.feeBps + sellAdapter.feeBps) / 10000);

      const netProfitUsd = grossProfitUsd - dexFeesUsd - gasUsd;

      const leg1MinOutRaw = applySlippage(leg1.amountOutRaw).toString();
      const leg2MinOutRaw = applySlippage(leg2.amountOutRaw).toString();

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
        deadline:
          Math.floor(Date.now() / 1000) + THRESHOLDS.routeDeadlineSeconds,
        legs: [
          {
            dex: leg1.dex,
            kind: leg1.kind,
            router: leg1.router,
            tokenIn: leg1.tokenIn,
            tokenOut: leg1.tokenOut,
            amountInRaw: leg1.amountInRaw,
            expectedOutRaw: leg1.amountOutRaw,
            minOutRaw: leg1MinOutRaw,
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
            minOutRaw: leg2MinOutRaw,
            feeBps: leg2.feeBps,
            fee: leg2.fee || 0
          }
        ]
      });
    }
  }

  return candidates.sort((a, b) => b.netProfitUsd - a.netProfitUsd);
}

module.exports = {
  applySlippage,
  buildTwoLegRoutes,
  estimateGasUsd
};
