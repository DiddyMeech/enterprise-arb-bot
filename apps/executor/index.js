const { ethers } = require("ethers");
const config = require("@arb/config");
const { logger } = require("@arb/telemetry");
const GasEngine = require("@arb/gas-engine");
const TxRouter = require("@arb/tx-router");
const MevRelay = require("@arb/mev");
const { buildExecutionPlan } = require("@arb/trade-decision-engine");

class ExecutorApp {
  constructor() {
    this.gasEngines = new Map();
    logger.info("[EXECUTOR] Booting executor service");
  }

  getChain(chainName) {
    const chain = Object.values(config.CHAINS).find((c) => c.name === chainName);
    if (!chain) throw new Error(`Unknown chain ${chainName}`);
    return chain;
  }

  getGasEngine(chainName, seedGasPrice) {
    if (!this.gasEngines.has(chainName)) {
      this.gasEngines.set(
        chainName,
        new GasEngine(seedGasPrice || ethers.BigNumber.from(1), config)
      );
    }
    return this.gasEngines.get(chainName);
  }

  async submitValidatedTrade(validationResult) {
    const { payload, evaluation } = validationResult;
    const chain = this.getChain(payload.chain);

    const { RpcManager } = require('../../packages/rpc-manager');
    const {
      buildExecutionPlan,
      buildFlashExecutionPlan
    } = require('../../packages/execution-engine');

    const rpcManager = RpcManager.fromEnv(payload.chain);
    const provider = rpcManager.getProvider();
    const wallet = new ethers.Wallet(config.PRIVATE_KEY, provider);

    const useFlashMode =
      String(process.env.FLASH_LOAN_ENABLED || 'false').toLowerCase() === 'true';

    if (!payload?.routePlan?.legs?.length) {
      throw new Error('Executor received no route legs');
    }

    const route = {
      chain:             payload.chain,
      tokenIn:           payload.tokenInAddress || payload.tokenIn,
      tokenOut:          payload.tokenOutAddress || payload.tokenOut,
      amountInRaw:       payload.routePlan.amountInRaw || payload.amountInRaw,
      minProfitTokenRaw: payload.routePlan.minProfitTokenRaw || '1',
      deadline:          payload.routePlan.deadline || Math.floor(Date.now() / 1000) + 45,
      legs:              payload.routePlan.legs
    };

    const executionPlan = useFlashMode
      ? buildFlashExecutionPlan({
          flashExecutorAddress:
            chain.flashExecutorAddress || process.env.ARB_FLASH_EXECUTOR_ADDRESS,
          route
        })
      : buildExecutionPlan({
          executorAddress: chain.contractAddress || config.ARB_CONTRACT_ADDRESS,
          route
        });

    logger.info('[EXECUTOR] Plan ready', {
      chain:  payload.chain,
      mode:   executionPlan.type,
      rpc:    provider.__rpcUrl,
      target: executionPlan.target
    });

    if (config.SAFE_MODE) {
      logger.warn('[SAFE MODE] Payload built but not broadcast', {
        chain:  payload.chain,
        mode:   executionPlan.type,
        target: executionPlan.target
      });
      return { ok: true, status: 'SIMULATED_SUCCESS', execId: `dry_run_${Date.now()}` };
    }

    const tx = await wallet.sendTransaction({
      to:       executionPlan.target,
      data:     executionPlan.calldata,
      gasLimit: executionPlan.gasLimit
    });

    logger.info('[EXECUTOR] TX submitted', { chain: payload.chain, mode: executionPlan.type, txHash: tx.hash });

    const receipt = await tx.wait();
    rpcManager.markSuccess(provider.__rpcUrl);

    logger.info('[EXECUTOR] TX confirmed', {
      chain:   payload.chain,
      txHash:  tx.hash,
      status:  receipt.status,
      gasUsed: receipt.gasUsed?.toString?.() || null
    });

    return { txHash: tx.hash, receipt };
  }

}

module.exports = new ExecutorApp();
setInterval(() => {}, 60000);
