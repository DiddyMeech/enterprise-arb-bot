const { MathUtil } = require('@arb/common');
const { logger } = require('@arb/telemetry');

class GasEngine {
    constructor(baseFee, config) {
        this.baseFee = baseFee;
        this.config = config;
        this.recentSuccessFees = [];
        this.recentFailures = [];
        this.currentPriorityFeeBps = 1000; // Start conservative at 10% premium over base
    }

    async fetchBlocknativeGas() {
        try {
            // High-precision block builder estimations per-block basis
            const response = await fetch('https://api.blocknative.com/gasprices/blockprices', {
                headers: { 'Authorization': process.env.BLOCKNATIVE_API_KEY || '' }
            });
            if (response.ok) {
                const data = await response.json();
                // Select the 99% probability gas tier for explicit MEV execution dominance
                const targetTier = data.blockPrices[0].estimatedPrices.find(p => p.confidence === 99);
                if (targetTier) {
                    return {
                        baseFee: data.blockPrices[0].baseFeePerGas,
                        priorityFee: targetTier.maxPriorityFeePerGas,
                        maxFee: targetTier.maxFeePerGas
                    };
                }
            }
        } catch (e) {
            logger.warn(`[GAS ENGINE] Blocknative Oracle fault fallback: ${e.message}`);
        }
        return null;
    }

    async calculateOptimalGas(expectedProfitUsd) {
        // Enforce the rule: Max gas cost ratio is 30% of profit 
        const maxSpendUsd = expectedProfitUsd * this.config.MAX_GAS_PROFIT_RATIO;
        
        // Dynamically shift priority behavior depending on block ingestion inclusion success
        if (this.recentFailures.length > 3) {
            this.currentPriorityFeeBps = Math.min(this.currentPriorityFeeBps + 500, 5000); // Bump by 5% increments
            logger.info(`[GAS ENGINE] Increased priority fee modifier to ${this.currentPriorityFeeBps/100}% due to missed inclusion windows`);
            this.recentFailures = []; // Reset local window
        } else if (this.recentSuccessFees.length > 5) {
            this.currentPriorityFeeBps = Math.max(this.currentPriorityFeeBps - 200, 100); // Drop by 2%
            logger.info(`[GAS ENGINE] Decreased priority fee modifier to ${this.currentPriorityFeeBps/100}% tracking overpayment optimization`);
            this.recentSuccessFees = [];
        }

        const blocknative = await this.fetchBlocknativeGas();
        let targetGasPrice;

        if (blocknative) {
            // EIP-1559 Base + Priority representation calculated in wei
            targetGasPrice = (blocknative.baseFee + blocknative.priorityFee) * (10 ** 9);
            // Front-running logic: Bidding exactly 1 wei over the highest mapped block competitor
            targetGasPrice += 1;
            logger.info(`[GAS ENGINE] Blocknative 99th Percentile active. Overbidding competitor priority by 1 wei.`);
        } else {
            const priorityMultiplier = 1 + (this.currentPriorityFeeBps / 10000);
            targetGasPrice = this.baseFee * priorityMultiplier;
            logger.info(`[GAS ENGINE] Internal heuristic heuristic active.`);
        }

        return {
            targetGasPrice,
            maxSpendUsd
        };
    }

    reportOutcome(success, gasPriceUsed) {
        if (success) {
            this.recentSuccessFees.push(gasPriceUsed);
        } else {
            this.recentFailures.push(Date.now());
        }
    }
}

module.exports = GasEngine;
