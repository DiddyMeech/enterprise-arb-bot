const { ethers } = require('ethers');
const { logger } = require('@arb/telemetry');

class QuoteEngine {
    constructor(providers) {
        this.providers = providers; // Map of chainId -> optimal provider
    }

    async getOptimalQuote(tokenIn, tokenOut, amountIn, dexAdapters) {
        const SLIPPAGE_BPS = Number(process.env.SLIPPAGE_BPS || '30');
        const opportunities = [];

        // Quote every buy/sell adapter pair to find the best cross-DEX round trip
        for (const buyAdapter of dexAdapters) {
            let leg1Out;
            try {
                leg1Out = await buyAdapter.getAmountOut(amountIn, [tokenIn, tokenOut]);
            } catch {
                continue;
            }
            if (!leg1Out) continue;

            for (const sellAdapter of dexAdapters) {
                if (buyAdapter.name === sellAdapter.name) continue; // skip same-DEX pairs

                let leg2Out;
                try {
                    leg2Out = await sellAdapter.getAmountOut(leg1Out, [tokenOut, tokenIn]);
                } catch {
                    continue;
                }
                if (!leg2Out) continue;

                const profitRaw = ethers.BigNumber.from(leg2Out).sub(ethers.BigNumber.from(amountIn));
                opportunities.push({
                    buyDex: buyAdapter.name,
                    sellDex: sellAdapter.name,
                    leg1OutRaw: leg1Out.toString(),
                    leg2OutRaw: leg2Out.toString(),
                    profitRaw,
                });
            }
        }

        if (!opportunities.length) {
            return { bestQuote: null, bestDex: null, targets: [], executePayloads: [], roundTripQuote: null, routePlan: null };
        }

        // Pick the most profitable cross-DEX pair
        opportunities.sort((a, b) => (a.profitRaw.gt(b.profitRaw) ? -1 : 1));
        const best = opportunities[0];

        if (!best.profitRaw.gt(0)) {
            return { bestQuote: best.leg1OutRaw, bestDex: `${best.buyDex}->${best.sellDex}`, targets: [], executePayloads: [], roundTripQuote: best.leg2OutRaw, routePlan: null };
        }

        const leg1MinOut = ethers.BigNumber.from(best.leg1OutRaw).mul(10000 - SLIPPAGE_BPS).div(10000);
        const leg2MinOut = ethers.BigNumber.from(best.leg2OutRaw).mul(10000 - SLIPPAGE_BPS).div(10000);

        return {
            bestQuote: best.leg1OutRaw,
            bestDex: `${best.buyDex}->${best.sellDex}`,
            targets: [],
            executePayloads: [],
            roundTripQuote: best.leg2OutRaw,
            routePlan: {
                buyDex: best.buyDex,
                sellDex: best.sellDex,
                expectedAmountOutRaw: best.leg2OutRaw,
                leg1OutRaw: best.leg1OutRaw,
                leg2OutRaw: best.leg2OutRaw,
                leg1MinOutRaw: leg1MinOut.toString(),
                leg2MinOutRaw: leg2MinOut.toString(),
                grossProfitTokenRaw: best.profitRaw.toString(),
            },
        };
    }

}

module.exports = QuoteEngine;
