const config = require('@arb/config');
const { logger } = require('@arb/telemetry');

class SizingEngine {
    constructor() {
        this.policy = config.POLICY;
    }

    /**
     * Determines absolute volumetric trade sizing strictly mapped to historical safety signals.
     * @param {Object} chainPolicy The active risk policy for the execution chain.
     * @param {String} sizeTier The evaluated tier boundary ('FULL', 'MEDIUM', 'SMALL', 'TINY', 'REJECT').
     * @param {Object} recentHistory Array containing the last N execution results for stability checks.
     * @returns {Object} Sizing instruction containing the multiplier and rationale.
     */
    calculateSize(chainPolicy, sizeTier, recentHistory) {
        try {
            if (sizeTier === 'REJECT') {
                return { allowed: false, multiplier: 0, reason: 'SCORE_REJECTED' };
            }

            // Base Multipliers derived from Policy Configuration Defaults
            let multiplier = 0;
            switch(sizeTier) {
                case 'FULL': multiplier = this.policy.sizing.full_multiplier; break;
                case 'MEDIUM': multiplier = this.policy.sizing.medium_multiplier; break;
                case 'SMALL': multiplier = this.policy.sizing.small_multiplier; break;
                case 'TINY': multiplier = this.policy.sizing.tiny_multiplier; break;
            }

            // --- HARD SAFETY RULES: DOWNSCALING ---
            
            // Look for recent indicators of instability
            const hasRecentLoss = recentHistory.some(h => ['LOSS', 'REVERTED'].includes(h.status));
            const hasRecentMiss = recentHistory.some(h => h.status === 'MISSED');
            const hasHighDrift = recentHistory.some(h => h.quote_to_fill_drift_bps > this.policy.risk.max_quote_to_fill_drift_bps * 0.8);
            
            if (this.policy.sizing.immediate_scale_down_on_instability) {
                if (hasRecentLoss) {
                    multiplier = Math.min(multiplier, this.policy.sizing.tiny_multiplier);
                    logger.warn(`[SIZING] Forced downscale to TINY (Recent Realized Loss/Revert detected)`);
                } else if (hasRecentMiss || hasHighDrift) {
                    multiplier = Math.min(multiplier, this.policy.sizing.small_multiplier);
                    logger.warn(`[SIZING] Forced downscale to SMALL (Recent Drift/Miss Instability detected)`);
                }
            }

            // --- HARD SAFETY RULES: UPSCALING ---
            // "never size up after simulated-only success. only size up after real realized net profit"
            if (this.policy.sizing.scale_up_requires_realized_wins && multiplier > this.policy.sizing.tiny_multiplier) {
                const recentRealizedWins = recentHistory.filter(h => h.status === 'WIN').length;
                if (recentRealizedWins === 0) {
                    // Cannot exceed TINY if there is absolutely no verifiable Realized positive execution history
                    multiplier = this.policy.sizing.tiny_multiplier;
                    logger.info(`[SIZING] Suppressing size mapped to ${sizeTier} -> TINY (No verified realized wins yet)`);
                }
            }

            // Final Evaluation
            const targetUsd = chainPolicy.baseline_trade_size_usd * multiplier;
            
            logger.info(`[SIZING] Sizing established at ${(multiplier * 100).toFixed(0)}% scalar -> $${targetUsd.toFixed(2)} Volumetric Capacity.`);
            return {
                allowed: true,
                multiplier: multiplier,
                baseUsd: chainPolicy.baseline_trade_size_usd,
                targetAmountUsd: targetUsd,
                reason: 'GEOMETRIC_SCALE_PASS'
            };

        } catch (err) {
            logger.error(`[SIZING] Severe size-calculation failure: ${err.message}`);
            return { allowed: false, multiplier: 0, reason: 'FAULT' };
        }
    }
}

module.exports = new SizingEngine();
