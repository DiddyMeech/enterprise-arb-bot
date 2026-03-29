const { ethers } = require("ethers");
const config = require("@arb/config");
const { logger } = require("@arb/telemetry");
const { evaluateOpportunity, buildExecutionPlan } = require("@arb/trade-decision-engine");

class RouteMemory {
  // Simple stub for RouteMemory implementation
  has(id) { return false; }
  set(id, val) { }
}

class SimulatorApp {
  constructor() {
    this.memory = new RouteMemory();
    logger.info("[SIMULATOR] Booted exact-route simulator");
  }

  getChain(chainName) {
    const chain = Object.values(config.CHAINS).find((c) => c.name === chainName);
    if (!chain) throw new Error(`Unknown chain ${chainName}`);
    return chain;
  }

  getProvider(chainName) {
    const chain = this.getChain(chainName);
    return new ethers.providers.JsonRpcProvider(chain.rpcs[0]);
  }

  async quoteExactRoute(opp, amountInUsd) {
    if (!opp.routePlan?.legs?.length) {
      return { ok: false, reason: "QUOTE_FAILED" };
    }

    return {
      ok: true,
      route: {
        chain: opp.chain,
        legs: opp.routePlan.legs,
        amountInUsd,
        expectedAmountOutRaw: opp.routePlan.expectedAmountOutRaw || "0",
        expectedGrossProfitUsd: opp.quotedGrossProfitUsd
      },
      grossProfitUsd: opp.quotedGrossProfitUsd,
      gasUsd: opp.estimatedGasUsd,
      dexFeesUsd: opp.routePlan.dexFeesUsd || 0,
      flashLoanFeeUsd: opp.routePlan.flashLoanFeeUsd || 0,
      amountOutRaw: opp.routePlan.expectedAmountOutRaw || "0"
    };
  }

  async simulateExactExecution({ opp, amountInUsd, mode, route, maxSlippageBps }) {
    const provider = this.getProvider(opp.chain);
    const chain = this.getChain(opp.chain);

    try {
      if (!opp.routePlan?.legs?.length) {
        return {
          ok: false,
          mode,
          decodedReason: "ROUTE_ENCODING_INVALID",
          reason: "ROUTE_ENCODING_INVALID"
        };
      }

      const minOutRaw =
        opp.routePlan.minOutRaw ||
        opp.routePlan.expectedAmountOutRaw ||
        "0";

      const deadline =
        Math.floor(Date.now() / 1000) + 20;

      const executionPlan = buildExecutionPlan({
        executorAddress: chain.contractAddress || config.ARB_CONTRACT_ADDRESS,
        mode,
        route: {
          chain: opp.chain,
          tokenIn: opp.tokenInAddress || opp.tokenIn,
          tokenOut: opp.tokenOutAddress || opp.tokenOut,
          amountInRaw: opp.amountInRaw,
          minProfitTokenRaw: opp.minProfitTokenRaw || "0",
          minOutRaw,
          deadline,
          legs: opp.routePlan.legs
        },
        gasLimit: 700000
      });

      await provider.call({
        to: executionPlan.target,
        data: executionPlan.calldata
      });

      return {
        ok: true,
        mode
      };
    } catch (error) {
      return {
        ok: false,
        mode,
        rawError: error,
        decodedReason: error?.reason || error?.message || "UNKNOWN_REVERT",
        reason: "REVERTED_OR_IMPOSSIBLE"
      };
    }
  }

  async processQueueEvent(opportunityPayload) {
    return await evaluateOpportunity(
      opportunityPayload,
      {
        quoteExactRoute: this.quoteExactRoute.bind(this),
        simulateExactExecution: this.simulateExactExecution.bind(this),
        log: (msg, payload) => logger.info(msg, payload || {})
      },
      this.memory
    );
  }
}

module.exports = new SimulatorApp();
setInterval(() => {}, 60000);
