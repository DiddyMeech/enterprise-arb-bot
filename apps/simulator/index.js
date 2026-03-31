require("dotenv").config({
  path: require("path").resolve(__dirname, "../../.env"),
});

const { getChain } = require("../../packages/config");
const { getOptimalQuote } = require("../../packages/quote-engine");
const {
  evaluateRoute,
  shouldExecuteRoute,
  rankRoutes,
  topRoutesByBucket,
} = require("../../packages/risk-engine");
const {
  getRouteFamilyKey,
  aggregateRouteFamilies,
  rankFamilies,
  topFamiliesByBucket,
  updateFamilyPriorityState,
  applyFamilyPriorityToScore,
  shouldExcludeFamily,
  shouldCooldownFamily,
} = require('../../packages/analytics');
const {
  buildExecutionPlan,
  buildFlashExecutionPlan,
  shouldBuildExecution,
  isRouteCoolingDown,
  markRouteFailure,
  clearRouteFailure,
  getTradingMode,
  shouldPermitLive,
  recordPaperTrade,
  recordLiveTrade,
  recordPaperCandidate,
  recordPaperSummary,
  recordWouldSend,
  recordFamilyAnalytics,
  checkLiveLimits,
  markFamilyFailure,
  clearFamilyFailure,
  isFamilyCoolingDown,
  getFamilyFailureState,
  shouldBroadcastTx,
  buildUnsignedTx,
  simulateUnsignedTx,
  broadcastSignedTx,
} = require('../../packages/execution-engine');
const { RpcManager } = require("../../packages/rpc-manager");

async function simulateOnce({ chainKey, amountInUsd, nativeTokenUsd }) {
  const chain = getChain(chainKey);
  const rpcManager = RpcManager.fromEnv(chainKey);

  const useFlashMode =
    String(process.env.FLASH_LOAN_ENABLED || "false").toLowerCase() === "true";

  const flashExecutorAddress =
    chain.flashExecutorAddress ||
    process.env.POLYGON_FLASH_EXECUTOR_ADDRESS ||
    process.env.ARB_FLASH_EXECUTOR_ADDRESS;

  const standardExecutorAddress =
    chain.executorAddress ||
    process.env.ARB_CONTRACT_ADDRESS;

  const usedFlashPlan = !!(useFlashMode || flashExecutorAddress);
  const tradingMode = getTradingMode();

  console.error("[simulator] FLASH_LOAN_ENABLED=", process.env.FLASH_LOAN_ENABLED);
  console.error("[simulator] useFlashMode=", useFlashMode);
  console.error("[simulator] usedFlashPlan=", usedFlashPlan);
  console.error("[simulator] ARB_FLASH_EXECUTOR_ADDRESS=", process.env.ARB_FLASH_EXECUTOR_ADDRESS);
  console.error("[simulator] POLYGON_FLASH_EXECUTOR_ADDRESS=", process.env.POLYGON_FLASH_EXECUTOR_ADDRESS);
  console.error("[simulator] ARB_CONTRACT_ADDRESS=", process.env.ARB_CONTRACT_ADDRESS);

  const provider = await rpcManager.getProvider("sim", 5000);

  let quote;
  try {
    quote = await getOptimalQuote({
      chainKey,
      provider,
      amountInUsd,
      nativeTokenUsd,
    });
  } catch (err) {
    return { ok: false, tradingMode, reason: `QUOTE_ERROR: ${err.message}`, amountInUsd };
  }

  if (!quote.ok || !quote.bestRoute) {
    return { ok: false, tradingMode, reason: "NO_ROUTE", amountInUsd };
  }

  let route = quote.bestRoute;
  const rankedRoutes = rankRoutes([route]);
  route = rankedRoutes[0] || route;
  
  route.metadata = {
    ...(route.metadata || {}),
    familyKey: getRouteFamilyKey(route),
  };

  const familyAnalytics = rankFamilies(
    aggregateRouteFamilies([route])
  );
  const familyBuckets = topFamiliesByBucket(familyAnalytics);
  const topFamily = familyAnalytics[0] || null;

  const familyPolicyState = topFamily
    ? updateFamilyPriorityState(topFamily)
    : null;

  const prioritizedRoute = topFamily
    ? applyFamilyPriorityToScore(route, topFamily)
    : route;

  route = prioritizedRoute;

  if (topFamily && shouldExcludeFamily(topFamily)) {
    return {
      ok: false,
      mode: usedFlashPlan ? "flash" : "standard",
      tradingMode,
      reason: "ROUTE_FAMILY_EXCLUDED",
      amountInUsd,
      route,
      liveGate: null,
      familyState: familyPolicyState,
      familySummary: topFamily,
    };
  }

  if (topFamily && shouldCooldownFamily(topFamily)) {
    return {
      ok: false,
      mode: usedFlashPlan ? "flash" : "standard",
      tradingMode,
      reason: "ROUTE_FAMILY_COOLDOWN",
      amountInUsd,
      route,
      liveGate: null,
      familyState: familyPolicyState,
      familySummary: topFamily,
    };
  }

  if (topFamily) {
    console.error("[family-policy] key=", topFamily.familyKey);
    console.error("[family-policy] dominantBucket=", topFamily.dominantBucket);
    console.error("[family-policy] policy=", familyPolicyState?.policy || "unknown");
    console.error("[family-policy] adjustedScore=", route?.ranking?.adjustedScore);

    if (tradingMode === "paper") {
      recordFamilyAnalytics(
        {
          topFamily,
          familyPolicy: familyPolicyState,
          counts: {
            strong_candidate: familyBuckets.strong_candidate?.length || 0,
            candidate: familyBuckets.candidate?.length || 0,
            near_miss: familyBuckets.near_miss?.length || 0,
            reject: familyBuckets.reject?.length || 0,
          },
        },
        {
          mode: usedFlashPlan ? "flash" : "standard",
          routeId: route?.id || null,
          familyKey: topFamily.familyKey,
          status: "FAMILY_ANALYTICS_OK",
        }
      );
    }
  }

  const evaluation = evaluateRoute(route);
  const liveGate = shouldExecuteRoute(route);

  if (!evaluation.ok) {
    return {
      ok: false,
      mode: usedFlashPlan ? "flash" : "standard",
      tradingMode,
      reason: evaluation.reasons.join(","),
      amountInUsd,
      route,
      liveGate,
    };
  }

  if (!liveGate.ok) {
    return {
      ok: false,
      mode: usedFlashPlan ? "flash" : "standard",
      tradingMode,
      reason: liveGate.reasons.join(","),
      amountInUsd,
      route,
      liveGate,
    };
  }

  const buildGate = shouldBuildExecution(route);

  if (!buildGate.ok) {
    return {
      ok: false,
      mode: usedFlashPlan ? "flash" : "standard",
      tradingMode,
      reason: buildGate.reasons.join(","),
      amountInUsd,
      route,
      liveGate,
      buildGate,
    };
  }

  if (isRouteCoolingDown(route)) {
    return {
      ok: false,
      mode: usedFlashPlan ? "flash" : "standard",
      tradingMode,
      reason: "ROUTE_IN_COOLDOWN",
      amountInUsd,
      route,
      liveGate,
      buildGate,
    };
  }

  if (isFamilyCoolingDown(route)) {
    return {
      ok: false,
      mode: usedFlashPlan ? "flash" : "standard",
      tradingMode,
      reason: "ROUTE_FAMILY_IN_COOLDOWN",
      amountInUsd,
      route,
      liveGate,
      buildGate,
      familyState: getFamilyFailureState(route),
    };
  }

  console.error("[execution] route.id=", route.id);
  console.error("[execution] route.shape=", route.shape);
  console.error("[execution] route.netProfitUsd=", route.netProfitUsd);
  console.error("[execution] route.grossProfitUsd=", route.grossProfitUsd);
  console.error("[execution] route.gasUsd=", route.gasUsd);
  console.error("[execution] route.flashFeeUsd=", route.flashFeeUsd);
  console.error("[execution] sizingMode=", route?.metadata?.sizingMode);
  console.error("[execution] exactRequoted=", route?.metadata?.exactRequoted);

  if (route?.ranking) {
    console.error("[ranking] score=", route.ranking.score);
    console.error("[ranking] bucket=", route.ranking.bucket);
    console.error("[ranking] scoreVersion=", route.ranking.scoreVersion);
    console.error("[ranking] driftPct=", route.ranking.driftPct);
    console.error("[ranking] legCount=", route.ranking.legCount);
    console.error("[ranking] execSlippage=", route.ranking.executionSlippageBps);
  }

  let executionPlan;
  try {
    executionPlan = usedFlashPlan
      ? buildFlashExecutionPlan({
          flashExecutorAddress,
          route
        })
      : buildExecutionPlan({
          executorAddress: standardExecutorAddress,
          route
        });
  } catch (err) {
    markRouteFailure(route);
    return {
      ok: false,
      mode: usedFlashPlan ? "flash" : "standard",
      tradingMode,
      reason: `PAYLOAD_BUILD_FAILED:${err.message}`,
      amountInUsd,
      route,
      liveGate,
      buildGate,
    };
  }

  try {
    await rpcManager.withProvider(
      "sim",
      async (simProvider) => {
        await simProvider.call({
          to: executionPlan.target,
          data: executionPlan.calldata,
        });
      },
      12000
    );

    clearRouteFailure(route);

    if (tradingMode === "paper") {
      recordPaperCandidate(route, {
        mode: usedFlashPlan ? "flash" : "standard",
        status: "SIM_OK",
      });

      recordPaperTrade(route, {
        mode: usedFlashPlan ? "flash" : "standard",
        status: "SIM_OK",
      });

      recordPaperSummary(
        {
          strong_candidate: bucketed.strong_candidate.length,
          candidate: bucketed.candidate.length,
          near_miss: bucketed.near_miss.length,
          reject: bucketed.reject.length,
          topScore: route?.ranking?.score ?? null,
          topBucket: route?.ranking?.bucket ?? null,
          routeId: route?.id ?? null,
        },
        {
          mode: usedFlashPlan ? "flash" : "standard",
          status: "SIM_OK",
        }
      );

      try {
        const [signer] = await require('hardhat').ethers.getSigners();
        const unsignedTx = await buildUnsignedTx({
          signer,
          executionPlan,
        });

        await simulateUnsignedTx(signer.provider, unsignedTx);

        recordWouldSend(route, {
          mode: usedFlashPlan ? "flash" : "standard",
          status: "WOULD_SEND_OK",
          tx: {
            to: unsignedTx.to,
            gasLimit: String(unsignedTx.gasLimit || ""),
          },
          familyKey: getRouteFamilyKey(route),
        });
      } catch (err) {
        markRouteFailure(route);
        markFamilyFailure(route);

        recordWouldSend(route, {
          mode: usedFlashPlan ? "flash" : "standard",
          status: "WOULD_SEND_FAIL",
          error: err.message,
          familyKey: getRouteFamilyKey(route),
        });
      }
    }

    if (tradingMode === "live") {
      const liveLimits = checkLiveLimits();
      if (!liveLimits.ok) {
        return {
          ok: false,
          mode: usedFlashPlan ? 'flash' : 'standard',
          tradingMode,
          reason: liveLimits.reasons.join(","),
          amountInUsd,
          route,
          liveGate,
          buildGate,
          liveLimits,
        };
      }

      const livePermit = shouldPermitLive({
        ...route,
        amountInUsd,
      });

      if (!livePermit.ok) {
        return {
          ok: false,
          mode: usedFlashPlan ? 'flash' : 'standard',
          tradingMode,
          reason: livePermit.reasons.join(","),
          amountInUsd,
          route,
          liveGate,
          buildGate,
          livePermit,
        };
      }

      const sendPermit = shouldBroadcastTx(route);

      if (!sendPermit.ok) {
        return {
          ok: false,
          mode: usedFlashPlan ? 'flash' : 'standard',
          tradingMode,
          reason: sendPermit.reasons.join(","),
          amountInUsd,
          route,
          liveGate,
          buildGate,
          livePermit,
          sendPermit,
        };
      }

      try {
        const [signer] = await require('hardhat').ethers.getSigners();

        const unsignedTx = await buildUnsignedTx({
          signer,
          executionPlan,
        });

        await simulateUnsignedTx(signer.provider, unsignedTx);

        const sentTx = await broadcastSignedTx(signer, unsignedTx);

        clearRouteFailure(route);
        clearFamilyFailure(route);

        recordLiveTrade(route, {
          mode: usedFlashPlan ? "flash" : "standard",
          status: "LIVE_SENT",
          txHash: sentTx.hash,
          familyKey: getRouteFamilyKey(route),
        });

        return {
          ok: true,
          mode: usedFlashPlan ? 'flash' : 'standard',
          tradingMode,
          amountInUsd,
          route,
          txHash: sentTx.hash,
          liveGate,
          buildGate,
          livePermit,
          sendPermit,
        };
      } catch (err) {
        markRouteFailure(route);
        markFamilyFailure(route);

        recordLiveTrade(route, {
          mode: usedFlashPlan ? "flash" : "standard",
          status: "LIVE_SEND_FAIL",
          error: err.message,
          familyKey: getRouteFamilyKey(route),
        });

        return {
          ok: false,
          mode: usedFlashPlan ? 'flash' : 'standard',
          tradingMode,
          reason: `LIVE_SEND_FAIL:${err.message}`,
          amountInUsd,
          route,
          liveGate,
          buildGate,
          livePermit,
          sendPermit,
          familyState: getFamilyFailureState(route),
        };
      }
    }

    return {
      ok: true,
      mode: usedFlashPlan ? "flash" : "standard",
      tradingMode,
      amountInUsd,
      route,
      liveGate,
      buildGate,
    };
  } catch (err) {
    markRouteFailure(route);
    return {
      ok: false,
      mode: usedFlashPlan ? "flash" : "standard",
      tradingMode,
      reason: `CALL_SIM_REVERT:${err.message}`,
      amountInUsd,
      route,
      liveGate,
      buildGate,
    };
  }
}

function getProbeSizes() {
  const raw =
    process.env.DRY_RUN_USD_SIZES ||
    `${process.env.DRY_RUN_USD || process.env.TRADE_USD_HINT || "5"},10,25`;

  return raw
    .split(",")
    .map((v) => Number(v.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
}

async function simulate({ chainKey, amountInUsd, nativeTokenUsd }) {
  if (amountInUsd) {
    return simulateOnce({ chainKey, amountInUsd, nativeTokenUsd });
  }

  const sizes = getProbeSizes();
  const attempts = [];

  for (const size of sizes) {
    const result = await simulateOnce({
      chainKey,
      amountInUsd: size,
      nativeTokenUsd,
    });
    attempts.push(result);
    if (result.ok) {
      return { ...result, attempts };
    }
  }

  return {
    ok: false,
    reason: "NO_ROUTE",
    attempts,
  };
}

if (require.main === module) {
  (async () => {
    const chainKey = process.env.ACTIVE_DEPLOY_CHAIN || "polygon";
    const nativeTokenUsd = Number(process.env.ETH_PRICE_USD_HINT || "2200");
    const result = await simulate({
      chainKey,
      amountInUsd: null,
      nativeTokenUsd,
    });
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 1);
  })().catch((err) => {
    console.error("[simulator] fatal", err);
    process.exit(1);
  });
}

module.exports = {
  simulate,
  simulateOnce,
};
