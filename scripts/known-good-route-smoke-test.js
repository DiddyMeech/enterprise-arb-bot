#!/usr/bin/env node

const { ethers } = require("ethers");
const config = require("@arb/config");
const {
  buildExecutionPlan,
  normalizeRoute,
  encodeDexLeg,
  getCodeInfo,
  decodeCommonRevert,
  buildSimFailureReport,
} = require("@arb/trade-decision-engine");

function getChain(name) {
  const chain = Object.values(config.CHAINS).find((c) => c.name === name);
  if (!chain) throw new Error(`Unknown chain: ${name}`);
  if (!chain.rpcs?.length) throw new Error(`No RPCs configured for ${name}`);
  return chain;
}

/**
 * Replace these with real known-good values for your deployment.
 * Start with one DEX, one router, one major pair, one small size.
 */
function getSmokeRoute(chainName) {
  if (chainName === "arbitrum") {
    return {
      tokenIn: process.env.SMOKE_TOKEN_IN,
      tokenOut: process.env.SMOKE_TOKEN_OUT,
      amountInRaw: process.env.SMOKE_AMOUNT_IN_RAW || "1000000",
      minOutRaw: process.env.SMOKE_MIN_OUT_RAW || "1",
      router: process.env.SMOKE_ROUTER,
      dex: process.env.SMOKE_DEX || "sushi",
      feeTier: process.env.SMOKE_FEE_TIER ? Number(process.env.SMOKE_FEE_TIER) : undefined,
      stable: process.env.SMOKE_STABLE === "true",
      recipient: process.env.SMOKE_RECIPIENT || (getChain(chainName).contractAddress || config.ARB_CONTRACT_ADDRESS),
      extra: {
        factory: process.env.SMOKE_FACTORY,
        referrer: process.env.SMOKE_REFERRER,
      },
    };
  }

  if (chainName === "base") {
    return {
      tokenIn: process.env.SMOKE_TOKEN_IN,
      tokenOut: process.env.SMOKE_TOKEN_OUT,
      amountInRaw: process.env.SMOKE_AMOUNT_IN_RAW || "1000000",
      minOutRaw: process.env.SMOKE_MIN_OUT_RAW || "1",
      router: process.env.SMOKE_ROUTER,
      dex: process.env.SMOKE_DEX || "aerodrome",
      feeTier: process.env.SMOKE_FEE_TIER ? Number(process.env.SMOKE_FEE_TIER) : undefined,
      stable: process.env.SMOKE_STABLE === "true",
      recipient: process.env.SMOKE_RECIPIENT || (getChain(chainName).contractAddress || config.ARB_CONTRACT_ADDRESS),
      extra: {
        factory: process.env.SMOKE_FACTORY,
        referrer: process.env.SMOKE_REFERRER,
      },
    };
  }

  throw new Error(`Unsupported chain for smoke route: ${chainName}`);
}

async function main() {
  const chainName = process.argv[2] || "arbitrum";
  const mode = process.argv[3] || "wallet";
  const chain = getChain(chainName);
  const provider = new ethers.providers.JsonRpcProvider(chain.rpcs[0]);
  const executorAddress = chain.contractAddress || config.ARB_CONTRACT_ADDRESS;

  if (!executorAddress) {
    throw new Error(`No executor configured for ${chainName}`);
  }

  const smoke = getSmokeRoute(chainName);

  if (!smoke.tokenIn || !smoke.tokenOut || !smoke.router) {
    throw new Error(
      "Missing smoke inputs. Set SMOKE_TOKEN_IN, SMOKE_TOKEN_OUT, and SMOKE_ROUTER in env."
    );
  }

  const deadline = Math.floor(Date.now() / 1000) + 60;

  const normalized = normalizeRoute({
    deadline,
    legs: [
      {
        dex: smoke.dex,
        router: smoke.router,
        tokenIn: smoke.tokenIn,
        tokenOut: smoke.tokenOut,
        recipient: smoke.recipient,
        amountInRaw: smoke.amountInRaw,
        minOutRaw: smoke.minOutRaw,
        feeTier: smoke.feeTier,
        stable: smoke.stable,
        extra: smoke.extra,
      },
    ],
  });

  const encodedLegs = normalized.map((leg) => encodeDexLeg(leg));

  const plan = buildExecutionPlan({
    executorAddress,
    mode,
    route: {
      chain: chainName,
      tokenIn: smoke.tokenIn,
      tokenOut: smoke.tokenOut,
      amountInRaw: smoke.amountInRaw,
      minProfitTokenRaw: "0",
      minOutRaw: smoke.minOutRaw,
      deadline,
      legs: encodedLegs,
    },
    gasLimit: 700000,
  });

  const codeInfo = await getCodeInfo(provider, executorAddress);

  console.log("=== KNOWN GOOD ROUTE SMOKE TEST ===");
  console.log("chain:", chainName);
  console.log("mode:", mode);
  console.log("executor:", executorAddress);
  console.log("executorCode:", codeInfo);
  console.log("routeHash:", plan.routeHash);
  console.log("legCount:", encodedLegs.length);
  console.log("legTargets:", encodedLegs.map((x) => x.target));
  console.log("outerSelector:", plan.calldata.slice(0, 10));
  console.log("");

  if (!codeInfo.hasCode) {
    throw new Error(`Executor has no code at ${executorAddress}`);
  }

  try {
    const result = await provider.call({
      to: plan.target,
      data: plan.calldata,
    });

    console.log("SIMULATION_OK");
    console.log("returnDataLength:", result.length);
  } catch (error) {
    const decodedReason = decodeCommonRevert(error);

    const report = buildSimFailureReport({
      chain: chainName,
      mode,
      executorTarget: plan.target,
      routeHash: plan.routeHash,
      calldata: plan.calldata,
      legTargets: plan.targets,
      legPayloads: plan.payloads,
      amountInRaw: smoke.amountInRaw,
      minOutRaw: smoke.minOutRaw,
      deadline,
      decodedReason,
    });

    console.error("SIMULATION_FAILED");
    console.error(JSON.stringify(report, null, 2));
    console.error("rawReason:", decodedReason);
    process.exit(2);
  }
}

main().catch((err) => {
  console.error("[known-good-route-smoke-test] failed:", err);
  process.exit(1);
});
