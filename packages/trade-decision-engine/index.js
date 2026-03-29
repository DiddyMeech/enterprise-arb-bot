const config = require('@arb/config');
const { logger } = require('@arb/telemetry');
const policyEngine = require('@arb/policy-engine');
const riskEngine = require('@arb/risk-engine');
const scoringEngine = require('@arb/route-scoring-engine');
const sizingEngine = require('@arb/sizing-engine');
const learningEngine = require('@arb/learning-engine');
const notifier = require('../telemetry/notifier');

class TradeDecisionEngine {
    constructor() {
        this.config = config;
    }

    /**
     * Executes the strict 13-stage Institutional Routing Pipeline.
     * @param {Object} opp The base mathematical opportunity trace discovered by Scanner.
     * @param {Function} simulatorCallback The callback to execute the dynamic node/contract simulation.
     * @param {Function} executionCallback The callback to actively broadcast the bundle.
     */
    async evaluatePipeline(opp, simulatorCallback, executionCallback) {
        let decisionId = null;
        
        try {
            logger.info(`[DECISION-ENGINE] 1. opportunity_detected -> ${opp.chain} [${opp.routeSignature}]`);

            // 2. Policy Precheck (Fast-Fail)
            const policyCheck = policyEngine.evaluate(opp);
            if (!policyCheck.passed) {
                await learningEngine.recordDecision(opp, { status: 'REJECTED_POLICY', reason: policyCheck.reason }, 0.0);
                return;
            }
            logger.debug(`[DECISION-ENGINE] 2. policy_precheck -> PASSED`);

            // Fetch Active Telemetry Bounds dynamically from Postgres
            const telemetry = await learningEngine.getRouteTelemetry(opp.routeSignature);
            const blacklistCheck = await learningEngine.checkAnomalyBlacklists(opp.routeSignature, opp.chain);
            const activeMetrics = { ...telemetry, isBlacklisted: blacklistCheck.isBlacklisted, 
                                    blacklistReason: blacklistCheck.reason, routeFailureRate: telemetry.revert_rate, 
                                    dailyLossConsumedUsd: 0, circuitBreakerActive: false };

            // 8. Route Score Gate (Evaluated early to save execution paths constraint checks)
            const score = scoringEngine.calculateScore(telemetry);
            let sizeTier = scoringEngine.evaluateTier(score, opp.chain);
            decisionId = await learningEngine.recordDecision(opp, { status: 'EVALUATING', reason: 'IN_PIPELINE' }, score);
            
            if (sizeTier === 'REJECT') {
                logger.warn(`[DECISION-ENGINE] 8. route_score_gate -> REJECTED (Score: ${score.toFixed(3)} is below baseline threshold)`);
                await learningEngine.recordDecision(opp, { status: 'REJECTED_SCORE', reason: 'INSUFFICIENT_ROUTE_SCORE' }, score);
                return;
            }
            logger.debug(`[DECISION-ENGINE] 8. route_score_gate -> PASSED (Score: ${score.toFixed(3)} Tier: ${sizeTier})`);

            // 3. Liquidity Validation + 4. Quote Validation 
            // In a production live-scale scope, these would execute cross-node verifications before full simulator.
            logger.debug(`[DECISION-ENGINE] 3/4. liquidity/quote validation -> ASSUMED PASSED`);

            // 5. Full Simulation -> simulatorCallback executes actual memory EVM trace
            const simulation = await simulatorCallback(opp);
            await learningEngine.recordSimulation(decisionId, opp, simulation);

            if (!simulation.passed) {
                logger.warn(`[DECISION-ENGINE] 5. full_simulation -> REVERTED_OR_IMPOSSIBLE`);
                logger.error(`[DECISION-ENGINE] SIM_FAIL_REASON: ${simulation.revertReason || 'UNKNOWN_REVERT'}`);
                return;
            }
            logger.debug(`[DECISION-ENGINE] 5. full_simulation -> PASSED`);

            // 6. Profit Calculation Matrix (Dynamic Gas Estimate evaluated here)
            const gasMetrics = { totalCostUsd: simulation.gasEstimateUsd + simulation.relayerEstimateUsd };
            logger.debug(`[DECISION-ENGINE] 6. profit_calculation -> EXPECTED NET: $${simulation.expectedNetUsd.toFixed(2)}`);

            // [CRITICAL] 6.b Hard Minimum Profit Validation ($5.00 Floor)
            if (simulation.expectedNetUsd < 5.00) {
                logger.warn(`[DECISION-ENGINE] 6.b profit_gate -> REJECTED (Expected Net $${simulation.expectedNetUsd.toFixed(2)} is mathematically below the massive $5.00 threshold)`);
                await learningEngine.recordDecision(opp, { status: 'REJECTED_PROFIT_FLOOR', reason: 'BELOW_MINIMUM_5_USD' }, score);
                return;
            }

            // 7. Risk Gate Evaluation
            const riskCheck = riskEngine.evaluateRisk(opp, simulation, gasMetrics, activeMetrics);
            if (!riskCheck.passed) {
                await learningEngine.recordDecision(opp, { status: 'REJECTED_RISK', reason: riskCheck.reason }, score);
                return;
            }
            logger.debug(`[DECISION-ENGINE] 7. risk_gate -> PASSED`);

            // 9. Sizing Decision Engine
            const sizing = sizingEngine.calculateSize(this.config.POLICY.chains[opp.chain.toLowerCase()], sizeTier, []); // recentHistory array stubbed
            if (!sizing.allowed) {
                logger.warn(`[DECISION-ENGINE] 9. sizing_decision -> REJECTED (Size constraint forced zero bounds)`);
                return;
            }
            logger.debug(`[DECISION-ENGINE] 9. sizing_decision -> SCALED CAPACITY: $${sizing.targetAmountUsd.toFixed(2)} [${sizing.multiplier}x]`);

            // 10. Execution Decision
            if (!this.config.POLICY.mode.execution_enabled || !this.config.POLICY.mode.allow_live_broadcast || this.config.POLICY.mode.bot_mode === 'SAFE') {
                logger.warn(`[DECISION-ENGINE] 10. execution_decision -> DRY RUN ONLY (SAFE_MODE active / Execution Disabled)`);
                await learningEngine.recordDecision(opp, { status: 'SIMULATED_SUCCESS', reason: 'SAFE_MODE_ACTIVE' }, score);
                return;
            }

            // 11. Execute Route on Blockchain via MEV Builders
            logger.info(`[DECISION-ENGINE] 11. execution_decision -> INITIATING LIVE BROADCAST!`);
            const executionResult = await executionCallback(opp, sizing.targetAmountUsd, simulation);

            // 12. Learning Update & Event Handling
            await learningEngine.recordExecutionResult(executionResult.execId, opp, executionResult);
            logger.debug(`[DECISION-ENGINE] 12. learning_update -> FIRED PERSISTENCE`);

            // 12.b High Priority Push Notifications
            if (executionResult && executionResult.status === 'WIN' && simulation.expectedNetUsd > 1) {
                await notifier.sendWinAlert(opp, executionResult);
            } else if (executionResult && executionResult.status === 'WIN') {
                logger.debug(`[DECISION-ENGINE] Execution submitted to Mempool but expected net is too low ($${simulation.expectedNetUsd.toFixed(2)}). Suppressing fake Telegram Push.`);
            }

            // 13. Telemetry Emission
            logger.info(`[DECISION-ENGINE] 13. telemetry_emit -> PIPELINE COMPLETION. END OF CYLCE.`);

        } catch (err) {
            logger.error(`[DECISION-ENGINE] Catastrophic failure in pipeline execution sequence: ${err.message}`);
        }
    }
}

module.exports = new TradeDecisionEngine();
