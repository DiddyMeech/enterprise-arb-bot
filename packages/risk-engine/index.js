const config = require('@arb/config');
const { logger } = require('@arb/telemetry');

class RiskEngine {
    constructor() {
        this.policy = config.POLICY;
    }

    /**
     * Executes the comprehensive Risk Gate assessment post-simulation.
     * @param {Object} opportunity The base discovered arbitrage payload.
     * @param {Object} simulation The locally evaluated callStatic simulation state.
     * @param {Object} gasMetrics The dynamic gas/relayer predictions.
     * @param {Object} activeMetrics ML telemetry representing dynamic system bounds (blacklists/drifts).
     */
    evaluateRisk(opportunity, simulation, gasMetrics, activeMetrics) {
        try {
            const chainPolicy = this.policy.chains[opportunity.chain.toLowerCase()];

            // 1. Gross & Net Profit Threshold Checks
            const expectedGrossUsd = simulation.expectedGrossUsd;
            const expectedNetUsd = expectedGrossUsd - gasMetrics.totalCostUsd;

            if (expectedGrossUsd <= 0) {
                return this.reject('NEGATIVE_GROSS_PROFIT', `Simulation guarantees structural gross loss. Expected: ${expectedGrossUsd.toFixed(2)} USD.`);
            }

            if (expectedNetUsd < chainPolicy.min_net_profit_usd) {
                return this.reject('NET_PROFIT_BELOW_MINIMUM', `Net yield (${expectedNetUsd.toFixed(2)} USD) is below the configured floor of ${chainPolicy.min_net_profit_usd} USD.`);
            }

            // 2. Gas Spend Ratio Limit
            const gasShare = gasMetrics.totalCostUsd / expectedGrossUsd;
            if (gasShare > chainPolicy.max_gas_share_of_profit) {
                return this.reject('EXCESSIVE_GAS_SHARE', `Gas fees consume ${(gasShare * 100).toFixed(1)}% of profit (Max Limit: ${(chainPolicy.max_gas_share_of_profit * 100).toFixed(1)}%).`);
            }

            // 3. Price Impact and Slippage Boundaries
            if (simulation.slippageEstimateBps > chainPolicy.max_slippage_bps) {
                return this.reject('SLIPPAGE_ESTIMATE_TOO_HIGH', `Model estimates ${simulation.slippageEstimateBps} bps slippage (Limit: ${chainPolicy.max_slippage_bps} bps).`);
            }

            // 4. Quotation Latency & Drift Bounds
            if (opportunity.providerDivergenceBps > chainPolicy.provider_divergence_bps) {
                return this.reject('PROVIDER_DIVERGENCE_EXCEEDED', `RPC nodes disagree significantly (${opportunity.providerDivergenceBps} bps). Risk of stale routing.`);
            }

            // 5. Systemic Checks against the Active Telemetry Blacklists
            if (activeMetrics.isBlacklisted) {
                return this.reject('DYNAMIC_BLACKLIST_ACTIVE', `Route signature or token combination is actively quarantined: ${activeMetrics.blacklistReason}`);
            }

            if (activeMetrics.circuitBreakerActive) {
                return this.reject('CIRCUIT_BREAKER_ACTIVE', `Global or chain-level pause engaged. Execution halted.`);
            }

            // 6. Loss & Failure Limits
            if (activeMetrics.routeFailureRate > 0.8) {
                return this.reject('ROUTE_FAILURE_RATE_EXCEEDED', `Historical revert rate on this route signature is critically high (${(activeMetrics.routeFailureRate * 100).toFixed(1)}%).`);
            }

            if (activeMetrics.dailyLossConsumedUsd > chainPolicy.daily_loss_cap_usd) {
                return this.reject('DAILY_LOSS_CAP_EXCEEDED', `Realized daily losses have hit the maximum ceiling.`);
            }

            logger.info(`[RISK-ENGINE] Simulation Payload passed strict risk gates on ${opportunity.chain}. Net Profit: $${expectedNetUsd.toFixed(2)}`);
            return { passed: true, expectedNetUsd, expectedGrossUsd, gasShare };

        } catch (err) {
            logger.error(`[RISK-ENGINE] System invariant failure during evaluation: ${err.message}`);
            return this.reject('RISK_EVALUATION_FAULT', err.message);
        }
    }

    reject(code, message) {
        // Muted to cleanly suppress terminal telemetry spam during massive pipeline rejection arrays
        // logger.warn(`[RISK-ENGINE] ❌ REJECTED [${code}]: ${message}`);
        return { passed: false, reason: code, details: message };
    }
}

module.exports = new RiskEngine();
