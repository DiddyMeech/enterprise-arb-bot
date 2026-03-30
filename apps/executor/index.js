require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const { ethers } = require('ethers');
const config = require('@arb/config');
const { getChain } = require('../../config/chains');
const { RpcManager } = require('../../packages/rpc-manager');
const {
  buildExecutionPlan,
  buildFlashExecutionPlan
} = require('../../packages/execution-engine');

class ExecutorApp {
  constructor({ logger = console } = {}) {
    this.logger = logger;
  }

  getChain(chainKey) {
    return getChain(chainKey);
  }

  async submitValidatedTrade(validationResult) {
    const { payload } = validationResult;
    const chain = this.getChain(payload.chain);
    const rpcManager = RpcManager.fromEnv(payload.chain);

    const provider = await rpcManager.getProvider('send');
    const wallet = new ethers.Wallet(
      process.env.PRIVATE_KEY || config.PRIVATE_KEY,
      provider
    );

    const useFlashMode =
      String(process.env.FLASH_LOAN_ENABLED || 'false').toLowerCase() === 'true';

    if (!payload?.routePlan?.legs?.length) {
      throw new Error('Executor received no route legs');
    }

    const route = {
      chain:             payload.chain,
      tokenIn:           payload.tokenInAddress || payload.routePlan.tokenIn || payload.tokenIn,
      tokenOut:          payload.tokenOutAddress || payload.routePlan.tokenOut || payload.tokenOut,
      amountInRaw:       payload.routePlan.amountInRaw || payload.amountInRaw,
      minProfitTokenRaw: payload.routePlan.minProfitTokenRaw || '1',
      deadline:          payload.routePlan.deadline,
      legs:              payload.routePlan.legs
    };

    const executionPlan = useFlashMode
      ? buildFlashExecutionPlan({
          flashExecutorAddress:
            chain.flashExecutorAddress || process.env.ARB_FLASH_EXECUTOR_ADDRESS,
          route
        })
      : buildExecutionPlan({
          executorAddress:
            chain.executorAddress || process.env.ARB_CONTRACT_ADDRESS,
          route
        });

    this.logger.info({
      msg:    'executor.plan.ready',
      chain:  payload.chain,
      mode:   useFlashMode ? 'flash' : 'standard',
      rpc:    provider.__rpcMeta?.url || null,
      target: executionPlan.target
    });

    const tx = await wallet.sendTransaction({
      to:       executionPlan.target,
      data:     executionPlan.calldata,
      gasLimit: executionPlan.gasLimit
    });

    this.logger.info({
      msg:   'executor.tx.submitted',
      chain: payload.chain,
      mode:  useFlashMode ? 'flash' : 'standard',
      txHash: tx.hash
    });

    const receipt = await tx.wait();

    this.logger.info({
      msg:     'executor.tx.confirmed',
      chain:   payload.chain,
      txHash:  tx.hash,
      status:  receipt.status,
      gasUsed: receipt.gasUsed?.toString?.() || null
    });

    return { txHash: tx.hash, receipt };
  }
}

module.exports = { ExecutorApp };
