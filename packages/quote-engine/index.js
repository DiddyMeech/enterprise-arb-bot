const { ethers } = require('ethers');
const { logger } = require('@arb/telemetry');

class QuoteEngine {
    constructor(providers) {
        this.providers = providers; // Map of chainId -> optimal provider
    }

    async getOptimalQuote(tokenIn, tokenOut, amountIn, dexAdapters) {
        let bestQuote = null;
        let bestDex = null;

        // Concurrently fetch pricing quotes across all locally mapped DEX adapters for speed
        const quotePromises = dexAdapters.map(async (adapter) => {
            try {
                const quote = await adapter.getAmountOut(amountIn, [tokenIn, tokenOut]);
                return { adapter: adapter.name, quote };
            } catch (err) {
                logger.debug(`[QUOTE ENGINE] Adapter ${adapter.name} failed quote projection: ${err.message}`);
                return null;
            }
        });

        const results = await Promise.all(quotePromises);

        for (const res of results) {
            if (res && res.quote) {
                if (!bestQuote || res.quote.gt(bestQuote)) {
                    bestQuote = res.quote;
                    bestDex = res.adapter;
                }
            }
        }

        return { bestQuote, bestDex };
    }
}

module.exports = QuoteEngine;
