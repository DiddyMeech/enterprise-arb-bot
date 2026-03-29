const { ethers } = require("ethers");
const config = require("@arb/config");
const { logger } = require("@arb/telemetry");
const { evaluateOpportunity } = require("@arb/trade-decision-engine");

class RouteMemory {
  // Simple stub for RouteMemory implementation
  has(id) { return false; }
  set(id, val) { }
}

class SimulatorApp {
  constructor() {
    this.memory = new RouteMemory();
    logger.info("[SIMULATOR] Booted exact-route simulation service");
  }

  getProviderForChain(chainName) {
    const chain = Object.values(config.CHAINS).find((c) => c.name === chainName);
    if (!chain) {
      throw new Error(`Unknown chain: ${chainName}`);
    }
    return {
      chain,
      provider: new ethers.providers.JsonRpcProvider(chain.rpcs[0]),
    };
  }

  async quoteExactRoute(opp, amountInUsd) {
    if (!opp.routePlan || !opp.routePlan.legs || opp.routePlan.legs.length === 0) {
      return { ok: false, reason: "QUOTE_FAILED" };
    }

    return {
      ok: true,
      route: {
        chain: opp.chain,
        legs: opp.routePlan.legs,
        amountInUsd,
        expectedAmountOutRaw: opp.routePlan.expectedAmountOutRaw || "0",
        expectedGrossProfitUsd: opp.quotedGrossProfitUsd,
      },
      grossProfitUsd: opp.quotedGrossProfitUsd,
      gasUsd: opp.estimatedGasUsd,
      dexFeesUsd: opp.routePlan.dexFeesUsd || 0,
      flashLoanFeeUsd: opp.routePlan.flashLoanFeeUsd || 0,
      amountOutRaw: opp.routePlan.expectedAmountOutRaw || "0",
    };
  }

  async simulateExactExecution({ opp, amountInUsd, mode, route, maxSlippageBps }) {
    const { provider } = this.getProviderForChain(opp.chain);

    if (!route?.legs?.length) {
      return {
        ok: false,
        mode,
        decodedReason: "ROUTE_ENCODING_INVALID",
        reason: "ROUTE_ENCODING_INVALID",
      };
    }

    try {
      // Replace this section with the actual calldata builder + eth_call path.
      // This is intentionally strict: simulator must reject if exact execution inputs are missing.
      if (!opp.executionPlan || !opp.executionPlan.calldata) {
        return {
          ok: false,
          mode,
          decodedReason: "CALLDATA_MISSING",
          reason: "ROUTE_ENCODING_INVALID",
        };
      }

      await provider.call({
        to: opp.executionPlan.target, // Re-mapped execution plan
        data: opp.executionPlan.calldata,
      });

      return {
        ok: true,
        mode,
      };
    } catch (error) {
      return {
        ok: false,
        mode,
        rawError: error,
        decodedReason: error?.reason || error?.message || "UNKNOWN_REVERT",
        reason: "REVERTED_OR_IMPOSSIBLE",
      };
    }
  }

  async processQueueEvent(opportunityPayload) {
    const result = await evaluateOpportunity(
      opportunityPayload,
      {
        quoteExactRoute: this.quoteExactRoute.bind(this),
        simulateExactExecution: this.simulateExactExecution.bind(this),
        log: (msg, payload) => logger.info(msg, payload || {}),
      },
      this.memory, // Stubbed memory fallback
    );

    return result;
  }
}

module.exports = new SimulatorApp();
setInterval(() => {}, 60000);
