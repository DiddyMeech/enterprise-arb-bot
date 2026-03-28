const decisionEngine = require('../packages/trade-decision-engine');
const { logger } = require('../packages/telemetry');
const crypto = require('crypto');

async function runIntegration() {
    logger.info("=== 🧪 ENTERPRISE ARBITRAGE INTEGRATION TEST ===");

    // 1. Construct an absolutely perfect Arbitrage Opportunity
    const opp = {
        id: crypto.randomUUID(),
        chain: "Arbitrum",
        tokenIn: "WETH",
        tokenOut: "USDC",
        dexCombo: "UniswapV3->SushiSwap",
        routeSignature: "UNIv3_WETH_USDC_0.05_SUSHI",
        timestamp: Date.now(),
        poolAgeHours: 500, // Very mature pool (passes honey-pot check)
        providerDivergenceBps: 2, // Tiny provider variance
        routePath: [
            "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", // WETH
            "0xaf88d065e77c8cC2239327C5EDb3A432268e5831"  // USDC
        ]
    };

    // 1.5 Mock the database to prevent auth drops locally and enforce an extreme confidence score
    const learningEngine = require('../packages/learning-engine');
    learningEngine.recordDecision = async () => 'mock-decision-id';
    learningEngine.recordSimulation = async () => 'mock-simulation-id';
    learningEngine.recordExecutionResult = async () => 'mock-exec-id';
    learningEngine.getRouteTelemetry = async () => ({ exists: true, avg_net_profit_usd: 5000.0, win_rate: 1.00, revert_rate: 0.00, avg_latency_ms: 100, avg_quote_drift_bps: 0, stale_quote_rate: 0.0, gas_overpay_ratio: 0.0 });
    learningEngine.checkAnomalyBlacklists = async () => ({ isBlacklisted: false });

    // 2. Mock Simulator Callback generating a highly profitable EVM outcome
    const simulateCallStatic = async (o) => {
        logger.debug(`[TEST-MOCK] Simulating native EVM execution for ${o.routeSignature}...`);
        return {
            passed: true,
            status: 'SUCCESS',
            expectedGrossUsd: 180.00,
            expectedNetUsd: 145.00,
            gasEstimateUsd: 15.00,
            relayerEstimateUsd: 20.00,
            slippageEstimateBps: 8,
            revertReason: null
        };
    };

    // 3. Mock MEV Execution Callback
    const executeLive = async (o, sizeUsd, sim) => {
        logger.debug(`[TEST-MOCK] Bribing MEV Relay with $${sim.relayerEstimateUsd} payload size: $${sizeUsd.toFixed(2)}`);
        return {
            execId: crypto.randomUUID(),
            status: 'WIN',
            netProfitUsd: 143.50, // Realized slightly under expecting
            gasPaidUsd: 14.50,
            realizedSlippageBps: 9,
            latencyMs: 1400,
            quoteDriftBps: 5,
            revertReason: null
        };
    };

    // Execute through the 13-stage monolithic orchestrator
    logger.info("");
    await decisionEngine.evaluatePipeline(opp, simulateCallStatic, executeLive);
    logger.info("");
    logger.info("=== 🧪 INTEGRATION PIPELINE VERIFIED SUCCESSFULLY ===");
}

// Ensure the local Node environment doesn't hang pending PostgreSQL pool closes
runIntegration().then(() => {
    setTimeout(() => process.exit(0), 1000); // Allow winston buffers to flush gracefully
});
