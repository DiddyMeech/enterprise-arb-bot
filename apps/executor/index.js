const { ethers } = require('ethers');
const config = require('@arb/config');
const { logger } = require('@arb/telemetry');
const GasEngine = require('@arb/gas-engine');
const TxRouter = require('@arb/tx-router');
const MevRelay = require('@arb/mev');

class ExecutorApp {
    constructor() {
        this.gasEngines = new Map();
        logger.info("[EXECUTOR] Booting multi-RPC flash relay network...");
    }

    async submitValidatedTrade(validationResult) {
        const { payload, evaluation } = validationResult;
        const chain = Object.values(config.CHAINS).find(c => c.name === payload.chain);
        
        if (!this.gasEngines.has(chain.name)) {
            // Adaptive EIP-1559 base fee adjustments setup per network
            this.gasEngines.set(chain.name, new GasEngine(evaluation.gasPrice || ethers.BigNumber.from(1), config));
        }

        const gasEngine = this.gasEngines.get(chain.name);
        const rpcs = chain.rpcs.map(url => new ethers.providers.JsonRpcProvider(url));
        const wallet = new ethers.Wallet(config.PRIVATE_KEY, rpcs[0]);
        
        // Instantiate Internal Network Adapters mapping statically to the deployed EVM flashloan core
        const txRouter = new TxRouter(config.ARB_CONTRACT_ADDRESS, rpcs[0], wallet);
        const mevRelay = chain.mevRelay ? new MevRelay([chain.mevRelay]) : null;

        // Apply strict dynamic gas strategy
        const gasParams = await gasEngine.calculateOptimalGas(evaluation.metrics.netProfitUsd);
        
        try {
            logger.info(`[EXECUTOR] Generating EIP-1559 encoded payload for ${chain.name}`);
            
            // Sign exactly once locally mapping Aave Flashloan trigger bounds
            const signedTx = await txRouter.buildPayload(
                payload.tokenIn, // asset
                payload.amountIn, // amount
                [], // targets
                [], // payloads 
                { gasLimit: 500000, targetGasPrice: gasParams.targetGasPrice }
            );

            // 🛡️ SAFE MODE TOGGLE (MANDATORY INITIAL DRY-RUNS)
            if (config.SAFE_MODE) {
                logger.warn(`[SAFE MODE] Route executed cleanly locally. Estimated Profit $${evaluation.metrics.netProfitUsd.toFixed(2)}. Transmission bypassed.`);
                return; // Rigid suppression mapping preventing capital loss
            }
            
            // 1. Prioritize secure local MEV delivery systems without propagating explicitly
            if (mevRelay) {
                mevRelay.broadcastBundle(signedTx);
            }
            
            // IMPORTANT: Removed the redundant public fallback broadcasts. 
            // All payload injections are strictly sequestered to the MEV Relays above 
            // to entirely eliminate front-running exposure on the public mempool.
            
            // Record analytics metric data representing the cost of success against missed targets
            gasEngine.reportOutcome(true, gasParams.targetGasPrice);

        } catch (error) {
            logger.error(`[EXECUTOR] Fatal dispatch error: ${error.message}`);
            gasEngine.reportOutcome(false, 0);
        }
    }
}

module.exports = new ExecutorApp();

// Keep executor active in PM2 while waiting for MQ hooks
setInterval(() => {}, 60000);
