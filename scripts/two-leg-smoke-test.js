#!/usr/bin/env node
/**
 * Two-Leg Circular Smoke Test
 * Encodes a full USDC → WETH → USDC route (or any pair) and runs provider.call()
 * to confirm the executor contract accepts the two-hop calldata without reverting.
 *
 * Usage:
 *   node scripts/two-leg-smoke-test.js [chain] [mode]
 *
 * Env vars:
 *   SMOKE_TOKEN_IN    (e.g. USDC on Arb: 0xFF970A...)
 *   SMOKE_TOKEN_OUT   (e.g. WETH on Arb: 0x82aF49...)
 *   SMOKE_ROUTER_BUY  Sushi router for leg1 buy  (defaults to SMOKE_ROUTER)
 *   SMOKE_ROUTER_SELL Sushi router for leg2 sell (defaults to SMOKE_ROUTER)
 *   SMOKE_AMOUNT_IN_RAW  raw amount in (e.g. 1000000 = 1 USDC)
 *   SMOKE_MIN_OUT_RAW    min acceptable final output (use 1 to skip slippage check)
 *   SMOKE_DEX         dex name (sushi/univ3/aerodrome/camelot)
 */

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

async function main() {
  const chainName = process.argv[2] || "arbitrum";
  const mode = process.argv[3] || "wallet";
  const chain = getChain(chainName);
  const provider = new ethers.providers.JsonRpcProvider(chain.rpcs[0]);
  const executorAddress = chain.contractAddress || config.ARB_CONTRACT_ADDRESS;

  if (!executorAddress) throw new Error(`No executor configured for ${chainName}`);

  const tokenIn  = process.env.SMOKE_TOKEN_IN;
  const tokenOut = process.env.SMOKE_TOKEN_OUT;
  const routerBuy  = process.env.SMOKE_ROUTER_BUY  || process.env.SMOKE_ROUTER;
  const routerSell = process.env.SMOKE_ROUTER_SELL || process.env.SMOKE_ROUTER;
  const amountInRaw  = process.env.SMOKE_AMOUNT_IN_RAW || "1000000";
  const minOutRaw    = process.env.SMOKE_MIN_OUT_RAW   || "1";
  const dex = process.env.SMOKE_DEX || "sushi";

  if (!tokenIn || !tokenOut || !routerBuy || !routerSell) {
    throw new Error(
      "Set SMOKE_TOKEN_IN, SMOKE_TOKEN_OUT, SMOKE_ROUTER (or SMOKE_ROUTER_BUY + SMOKE_ROUTER_SELL)"
    );
  }

  const deadline = Math.floor(Date.now() / 1000) + 60;

  // ── Step 1: query live Sushi pair to get a real amountOut for leg 1 ──────
  // This makes leg 2 amountIn realistic so the K-invariant check passes.
  let leg2AmountInRaw = amountInRaw; // fallback
  try {
    const pairIface = new ethers.utils.Interface([
      "function getAmountsOut(uint amountIn, address[] path) view returns (uint[] amounts)"
    ]);
    const router = new ethers.Contract(routerBuy, pairIface, provider);
    const amounts = await router.getAmountsOut(amountInRaw, [tokenIn, tokenOut]);
    leg2AmountInRaw = amounts[1].toString();
    console.log(`live leg1 quote: ${amountInRaw} → ${leg2AmountInRaw} (${dex})`);
  } catch (e) {
    console.warn(`getAmountsOut failed (${e.message}) — using amountInRaw as leg2 input`);
  }

  // ── Step 2: build two-leg normalized route ───────────────────────────────
  const normalized = normalizeRoute({
    deadline,
    legs: [
      {
        dex,
        router: routerBuy,
        tokenIn,
        tokenOut,
        recipient: executorAddress, // executor holds intermediate token
        amountInRaw,
        minOutRaw: "1",             // leg 1 min — executor guards final output
        feeTier: process.env.SMOKE_FEE_TIER ? Number(process.env.SMOKE_FEE_TIER) : undefined,
        stable: process.env.SMOKE_STABLE === "true",
        extra: {
          factory:  process.env.SMOKE_FACTORY,
          referrer: process.env.SMOKE_REFERRER,
        },
      },
      {
        dex,
        router: routerSell,
        tokenIn:  tokenOut,          // return leg: sell what we bought
        tokenOut: tokenIn,           // back to origin
        recipient: executorAddress,
        amountInRaw: leg2AmountInRaw,
        minOutRaw,                   // final profit guard
        feeTier: process.env.SMOKE_FEE_TIER ? Number(process.env.SMOKE_FEE_TIER) : undefined,
        stable: process.env.SMOKE_STABLE === "true",
        extra: {
          factory:  process.env.SMOKE_FACTORY,
          referrer: process.env.SMOKE_REFERRER,
        },
      },
    ],
  });

  const encodedLegs = normalized.map((leg) => encodeDexLeg(leg));

  const plan = buildExecutionPlan({
    executorAddress,
    mode,
    route: {
      chain: chainName,
      tokenIn,
      tokenOut: tokenIn,     // circular — ends back at tokenIn
      amountInRaw,
      minProfitTokenRaw: "0",
      minOutRaw,
      deadline,
      legs: encodedLegs,
    },
    gasLimit: 900000,
  });

  const codeInfo = await getCodeInfo(provider, executorAddress);

  console.log("\n=== TWO-LEG CIRCULAR SMOKE TEST ===");
  console.log("chain:       ", chainName);
  console.log("mode:        ", mode);
  console.log("executor:    ", executorAddress);
  console.log("hasCode:     ", codeInfo.hasCode, `(${codeInfo.codeSize} bytes)`);
  console.log("route:       ", `${tokenIn} → ${tokenOut} → ${tokenIn}`);
  console.log("legCount:    ", encodedLegs.length);
  console.log("legTargets:  ", encodedLegs.map((x) => x.target));
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
    console.log("SIMULATION_OK ✅");
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
      amountInRaw,
      minOutRaw,
      deadline,
      decodedReason,
    });
    console.error("SIMULATION_FAILED ❌");
    console.error(JSON.stringify(report, null, 2));
    console.error("rawReason:", decodedReason);
    process.exit(2);
  }
}

main().catch((err) => {
  console.error("[two-leg-smoke-test] failed:", err.message);
  process.exit(1);
});
