const { ethers } = require("ethers");
const config = require("@arb/config");
const { logger } = require("@arb/telemetry");
const {
  RouteMemory,
  evaluateOpportunity,
  buildExecutionPlan,
  normalizeRoute,
  encodeDexLeg
} = require("@arb/trade-decision-engine");
const {
  getCodeInfo,
  decodeCommonRevert,
  buildSimFailureReport
} = require("@arb/trade-decision-engine"); // Exposing from index instead of direct file mapping (best practice applied)

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
      const deadline = Math.floor(Date.now() / 1000) + 30;

      const normalized = normalizeRoute({
        deadline,
        legs: opp.routePlan.rawLegs || opp.routePlan.legs // fallback if parser sends raw
      });

      const encodedLegs = normalized.map((leg) => encodeDexLeg(leg));

      const executionPlan = buildExecutionPlan({
        executorAddress: chain.contractAddress || config.ARB_CONTRACT_ADDRESS,
        mode,
        route: {
          chain: opp.chain,
          tokenIn: opp.tokenInAddress || opp.tokenIn,
          tokenOut: opp.tokenOutAddress || opp.tokenOut,
          amountInRaw: opp.amountInRaw,
          minProfitTokenRaw: opp.minProfitTokenRaw || "0",
          minOutRaw: opp.routePlan.minOutRaw || opp.routePlan.expectedAmountOutRaw || "0",
          deadline,
          legs: encodedLegs
        },
        gasLimit: 700000
      });

      const codeInfo = await getCodeInfo(provider, executionPlan.target);
      if (!codeInfo.hasCode) {
        return {
          ok: false,
          mode,
          decodedReason: "EXECUTOR_NO_CODE",
          reason: "REVERTED_OR_IMPOSSIBLE"
        };
      }

      await provider.call({
        to: executionPlan.target,
        data: executionPlan.calldata
      });

      return {
        ok: true,
        mode
      };
    } catch (error) {
      const decodedReason = decodeCommonRevert(error);

      try {
        const failureReport = buildSimFailureReport({
          chain: opp.chain,
          mode,
          executorTarget: chain.contractAddress || config.ARB_CONTRACT_ADDRESS,
          routeHash: "unknown",
          calldata: error?.transaction?.data || "0x",
          legTargets: (opp.routePlan?.rawLegs || opp.routePlan?.legs || []).map((x) => x.router || "unknown"),
          legPayloads: [],
          amountInRaw: opp.amountInRaw || "0",
          minOutRaw: opp.routePlan?.minOutRaw || opp.routePlan?.expectedAmountOutRaw || "0",
          deadline: Math.floor(Date.now() / 1000) + 30,
          decodedReason
        });

        logger.warn("[SIM_DEBUG] exact execution revert", failureReport);
      } catch (debugErr) {
        logger.warn("[SIM_DEBUG] failed to build failure report", { error: String(debugErr) });
      }

      return {
        ok: false,
        mode,
        rawError: error,
        decodedReason,
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
