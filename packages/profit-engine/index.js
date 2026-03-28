const { MathUtil } = require('@arb/common');
const config = require('@arb/config');
const { logger } = require('@arb/telemetry');

class ProfitEngine {
    constructor() {}

    evaluateOpportunity(revenueNative, inputNative, gasLimit, gasPrice, tokenUsdPrice, poolAgeDays) {
        // Enforce the critical honey-pot resistance constraint (Pool > 7 days)
        if (poolAgeDays < config.POOL_AGE_DAYS_MIN) {
            logger.warn(`[PROFIT ENGINE] Trade Voided: Pool age ${poolAgeDays} < ${config.POOL_AGE_DAYS_MIN} days`);
            return { approved: false, reason: "Pool too new, high rug risk" };
        }

        const metrics = MathUtil.estimateNetProfit(revenueNative, inputNative, gasLimit, gasPrice, tokenUsdPrice, 0);

        // Core Constraints: $40 Min Profit and 30% Max Gas Ratio Enforcement
        const grossUsdFloat = parseFloat(metrics.grossProfitNative.toString()) * tokenUsdPrice;
        const gasRatio = MathUtil.calculateGasToProfitRatio(metrics.gasCostUsd, grossUsdFloat);

        if (metrics.netProfitUsd < config.MIN_PROFIT_USD) {
            logger.info(`[PROFIT ENGINE] Trade Voided: Net profit $${metrics.netProfitUsd.toFixed(2)} strictly below required target $${config.MIN_PROFIT_USD}`);
            return { approved: false, reason: "Insufficient profit threshold", metrics };
        }

        if (gasRatio > config.MAX_GAS_PROFIT_RATIO) {
            logger.warn(`[PROFIT ENGINE] Trade Voided: Gas ratio ${(gasRatio*100).toFixed(1)}% strictly exceeds limit of ${(config.MAX_GAS_PROFIT_RATIO*100).toFixed(1)}%`);
            return { approved: false, reason: "Gas ratio exceeded strict caps", metrics };
        }

        return { approved: true, metrics };
    }
}

module.exports = ProfitEngine;
