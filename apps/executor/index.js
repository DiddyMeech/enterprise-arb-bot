const { ethers } = require("ethers");
const config = require("@arb/config");
const { logger } = require("@arb/telemetry");
const GasEngine = require("@arb/gas-engine");
const TxRouter = require("@arb/tx-router");
const MevRelay = require("@arb/mev");

class ExecutorApp {
  constructor() {
    this.gasEngines = new Map();
    logger.info("[EXECUTOR] Booting executor service");
  }

  getChain(chainName) {
    const chain = Object.values(config.CHAINS).find((c) => c.name === chainName);
    if (!chain) {
      throw new Error(`Unknown chain: ${chainName}`);
    }
    return chain;
  }

  getGasEngine(chainName, seedGasPrice) {
    if (!this.gasEngines.has(chainName)) {
      this.gasEngines.set(
        chainName,
        new GasEngine(seedGasPrice || ethers.BigNumber.from(1), config),
      );
    }
    return this.gasEngines.get(chainName);
  }

  async submitValidatedTrade(validationResult) {
    const { payload, evaluation } = validationResult;
    const chain = this.getChain(payload.chain);
    const provider = new ethers.providers.JsonRpcProvider(chain.rpcs[0]);
    const wallet = new ethers.Wallet(config.PRIVATE_KEY, provider);
    const gasEngine = this.getGasEngine(chain.name, evaluation?.diagnostics?.gasPrice);

    if (!payload?.routePlan?.legs?.length) {
      throw new Error("Executor received validation result without route legs");
    }
    if (!payload?.executionPlan?.targets?.length || !payload?.executionPlan?.payloads?.length) {
      throw new Error("Executor received validation result without executable calldata");
    }

    const txRouter = new TxRouter(
      chain.contractAddress || config.ARB_CONTRACT_ADDRESS,
      provider,
      wallet,
    );
    const mevRelay = chain.mevRelay ? new MevRelay([chain.mevRelay], chain.name) : null;
    const gasParams = await gasEngine.calculateOptimalGas(evaluation.netProfitUsd || evaluation.metrics?.netProfitUsd || 0);

    logger.info("[EXECUTOR] Building signed transaction", {
      chain: chain.name,
      mode: evaluation.mode,
      amountInUsd: evaluation.bestSizeUsd,
    });

    const signedTx = await txRouter.buildPayload(
      payload.tokenIn,
      payload.amountIn,
      payload.executionPlan.targets,
      payload.executionPlan.payloads,
      {
        gasLimit: payload.executionPlan.gasLimit || 500000,
        targetGasPrice: gasParams.targetGasPrice,
      },
    );

    if (config.SAFE_MODE) {
      logger.warn("[SAFE MODE] Signed execution payload generated but not broadcast", {
        chain: chain.name,
        expectedNetUsd: evaluation.netProfitUsd || evaluation.metrics?.netProfitUsd,
      });
      return {
        ok: true,
        status: "SIMULATED_SUCCESS",
        execId: `dry_run_${Date.now()}`,
      };
    }

    if (!mevRelay) {
      throw new Error(`No relay configured for chain ${chain.name}`);
    }

    const relayResult = await mevRelay.broadcastBundle(signedTx);
    gasEngine.reportOutcome(true, gasParams.targetGasPrice);

    return relayResult;
  }
}

module.exports = new ExecutorApp();
setInterval(() => {}, 60000);
