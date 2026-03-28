const config = require('@arb/config');
const { logger } = require('@arb/telemetry');

class RouteScoringEngine {
    constructor() {
        this.policy = config.POLICY;
        
        // Base normalizer weights defined by the Institutional Blueprint
        this.weights = {
            avg_net_profit: 0.35,
            win_rate: 0.20,
            revert_rate: 0.15, // Penalty
            latency: 0.10,     // Penalty
            drift: 0.10,       // Penalty
            gas_efficiency: 0.05, // Penalty
            staleness: 0.05    // Penalty
        };
    }

    /**
     * Normalizes a target scalar into a bounded metric 0.0 -> 1.0.
     */
    normalize(val, minTarget, maxTarget, invert = false) {
        let normalized = (val - minTarget) / (maxTarget - minTarget);
        if (normalized > 1.0) normalized = 1.0;
        if (normalized < 0.0) normalized = 0.0;
        return invert ? (1.0 - normalized) : normalized;
    }

    /**
     * Executes the comprehensive scoring formula extracting Route Quality.
     * @param {Object} metrics The historical ML telemetry array for this specific Route / Chain combo.
     * @returns {Number} Evaluated bounded score between 0.0 and 1.0.
     */
    calculateScore(metrics) {
        try {
            // Profit normalization (Assume $0 to $1000 is the reasonable scale)
            const normProfit = this.normalize(metrics.avg_net_profit_usd || 0, 0, 1000);
            
            // Win rate is naturally 0.0 -> 1.0
            const normWinRate = Math.max(0, Math.min(1, metrics.win_rate || 0.0));

            // Convert penalties into normalized inverted matrices (0.0 to 1.0, where 1.0 is BAD)
            // Revert rate 0.0 to 1.0
            const normRevert = Math.max(0, Math.min(1, metrics.revert_rate || 0.0));
            
            // Latency normalization (100ms == perfect, 5000ms == worst)
            const normLatency = this.normalize(metrics.avg_latency_ms || 2000, 100, 5000);
            
            // Drift normalization (0 bps = perfect, 100 bps = worst)
            const normDrift = this.normalize(metrics.avg_quote_drift_bps || 10, 0, 100);
            
            // Gas inefficiency (Gas Paid / Gross Profit) - 0.0 = perfect, 0.40 = worst
            const normGas = this.normalize(metrics.gas_overpay_ratio || 0.10, 0, 0.40);
            
            // Staleness rate (Age of quote anomalies) - 0.0 = perfect, 1.0 = worst
            const normStale = Math.max(0, Math.min(1, metrics.stale_quote_rate || 0.0));

            // Positive Matrix Additions
            const basePositive = 
                (this.weights.avg_net_profit * normProfit) + 
                (this.weights.win_rate * normWinRate);

            // Negative Matrix Penalties
            const basePenalties = 
                (this.weights.revert_rate * normRevert) +
                (this.weights.latency * normLatency) +
                (this.weights.drift * normDrift) +
                (this.weights.gas_efficiency * normGas) +
                (this.weights.staleness * normStale);

            // Final Composite Extraction
            let finalScore = basePositive - basePenalties;

            // Failsafe Bounds Wrapper (Prevents > 1.0 or < 0.0 on extreme telemetry anomalies)
            if (finalScore < 0.0) finalScore = 0.0;
            if (finalScore > 1.0) finalScore = 1.0;

            logger.debug(`[ROUTE-SCORER] Historical Route evaluated. Positive Matrix: ${basePositive.toFixed(3)}, Penalties: ${basePenalties.toFixed(3)} -> Final Score: ${finalScore.toFixed(3)}`);
            return finalScore;

        } catch (err) {
            logger.error(`[ROUTE-SCORER] Algorithm normalization failure: ${err.message}`);
            return 0.0; // Fail-safe worst score on unhandled scalar invariants
        }
    }

    /**
     * Sizing Tier Evaluation
     * @param {Number} score Bounded 0.0 -> 1.0 metric
     * @param {String} chain Specific chain execution context
     */
    evaluateTier(score, chain) {
        const cPolicy = this.policy.chains[chain.toLowerCase()];
        
        if (score < cPolicy.baseline_score_threshold) return 'REJECT';
        if (score >= cPolicy.score_full_threshold) return 'FULL';
        if (score >= cPolicy.score_medium_threshold) return 'MEDIUM';
        if (score >= cPolicy.score_small_threshold) return 'SMALL';
        return 'TINY';
    }
}

module.exports = new RouteScoringEngine();
