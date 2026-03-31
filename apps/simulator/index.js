require("dotenv").config({
  path: require("path").resolve(__dirname, "../../.env"),
});

const { getChain } = require("../../packages/config");
const { getOptimalQuote } = require("../../packages/quote-engine");
const { evaluateRoute } = require("../../packages/risk-engine");
const {
  buildExecutionPlan,
  buildFlashExecutionPlan,
} = require("../../packages/execution-engine");
const { RpcManager } = require("../../packages/rpc-manager");

async function simulateOnce({ chainKey, amountInUsd, nativeTokenUsd }) {
  const chain = getChain(chainKey);
  const rpcManager = RpcManager.fromEnv(chainKey);

  const useFlashMode =
    String(process.env.FLASH_LOAN_ENABLED || "false").toLowerCase() === "true";

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
    return { ok: false, reason: `QUOTE_ERROR: ${err.message}`, amountInUsd };
  }

  if (!quote.ok || !quote.bestRoute) {
    return { ok: false, reason: "NO_ROUTE", amountInUsd };
  }

  const route = quote.bestRoute;
  const evaluation = evaluateRoute(route);

  if (!evaluation.ok) {
    return {
      ok: false,
      reason: evaluation.reasons.join(","),
      amountInUsd,
      route,
    };
  }

  const executionPlan = useFlashMode
    ? buildFlashExecutionPlan({
        flashExecutorAddress:
          chain.flashExecutorAddress ||
          process.env.POLYGON_FLASH_EXECUTOR_ADDRESS ||
          process.env.ARB_FLASH_EXECUTOR_ADDRESS,
        route,
      })
    : buildExecutionPlan({
        executorAddress:
          chain.executorAddress || process.env.ARB_CONTRACT_ADDRESS,
        route,
      });

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

    return {
      ok: true,
      mode: useFlashMode ? "flash" : "standard",
      amountInUsd,
      route,
    };
  } catch (err) {
    return {
      ok: false,
      mode: useFlashMode ? "flash" : "standard",
      reason: err.message,
      amountInUsd,
      route,
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
