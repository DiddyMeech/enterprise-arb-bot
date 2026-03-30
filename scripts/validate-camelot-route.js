#!/usr/bin/env node
/**
 * validate-camelot-route.js
 *
 * Structural proof-of-life for Camelot integration on Arbitrum.
 *
 * What it verifies:
 *   1. CAMELOT_ROUTER has deployed code on-chain
 *   2. Executor has deployed code on-chain
 *   3. encodeDexLeg("camelot") succeeds and produces sane calldata
 *   4. buildExecutionPlan succeeds (correct ABI + selector)
 *   5. eth_call through executor does not revert (simulation)
 *
 * Exit codes:
 *   0 — CAMELOT_SIMULATION_OK
 *   1 — missing config / setup error (check message)
 *   2 — simulation revert (see JSON failure report)
 *
 * Usage:
 *   npm run validate:camelot
 *
 *   or inline:
 *   CAMELOT_ROUTER=0x... \
 *   CAMELOT_TEST_TOKEN_IN=0x... \
 *   CAMELOT_TEST_TOKEN_OUT=0x... \
 *   npm run validate:camelot
 */

require("dotenv").config();

const { ethers } = require("ethers");
const config = require("@arb/config");
const {
  normalizeRoute,
  encodeDexLeg,
  buildExecutionPlan,
  getCodeInfo,
  decodeCommonRevert,
  buildSimFailureReport,
} = require("@arb/trade-decision-engine");

// ── Helpers ────────────────────────────────────────────────────────────────

function getChain(name) {
  const chain = Object.values(config.CHAINS).find((c) => c.name === name);
  if (!chain) throw new Error(`Unknown chain: ${name}`);
  if (!chain.rpcs?.length) throw new Error(`No RPCs configured for ${name}`);
  return chain;
}

function requiredEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const chainName = "arbitrum";
  const mode      = "wallet";

  const chain           = getChain(chainName);
  const provider        = new ethers.providers.JsonRpcProvider(chain.rpcs[0]);
  const executorAddress = chain.contractAddress || config.ARB_CONTRACT_ADDRESS;

  if (!executorAddress) {
    throw new Error("Missing executor address. Set ARB_CONTRACT_ADDRESS in .env");
  }

  // ── Route config ──────────────────────────────────────────────────────────
  const router     = requiredEnv("CAMELOT_ROUTER");
  const tokenIn    = requiredEnv("CAMELOT_TEST_TOKEN_IN");
  const tokenOut   = requiredEnv("CAMELOT_TEST_TOKEN_OUT");

  const amountInRaw = process.env.CAMELOT_TEST_AMOUNT_IN_RAW || "1000000"; // 1 USDC default
  const minOutRaw   = process.env.CAMELOT_TEST_MIN_OUT_RAW   || "1";
  const recipient   = process.env.CAMELOT_TEST_RECIPIENT      || executorAddress;
  const referrer    = process.env.CAMELOT_REFERRER             || ethers.constants.AddressZero;
  const deadline    = Math.floor(Date.now() / 1000) + 60;

  // ── Code existence checks ─────────────────────────────────────────────────
  const [routerCode, executorCode] = await Promise.all([
    getCodeInfo(provider, router),
    getCodeInfo(provider, executorAddress),
  ]);

  console.log("=== CAMELOT ROUTE VALIDATION ===");
  console.log("chain:        ", chainName);
  console.log("router:       ", router);
  console.log("executor:     ", executorAddress);
  console.log("routerCode:   ", routerCode);
  console.log("executorCode: ", executorCode);
  console.log("");

  if (!routerCode.hasCode) {
    throw new Error(`Camelot router has no code at ${router}. Check CAMELOT_ROUTER address.`);
  }

  if (!executorCode.hasCode) {
    throw new Error(`Executor has no code at ${executorAddress}. Check ARB_CONTRACT_ADDRESS.`);
  }

  // ── Encode leg ────────────────────────────────────────────────────────────
  const normalized = normalizeRoute({
    deadline,
    legs: [
      {
        dex:        "camelot",
        router,
        tokenIn,
        tokenOut,
        recipient,
        amountInRaw,
        minOutRaw,
        extra: { referrer },
      },
    ],
  });

  const encodedLegs = normalized.map((leg) => encodeDexLeg(leg));

  console.log("encoded leg count:", encodedLegs.length);
  console.log("leg target:       ", encodedLegs[0]?.target);
  console.log("leg calldata len: ", encodedLegs[0]?.calldata?.length ?? 0);
  console.log("leg debug:        ", encodedLegs[0]?.debug ?? {});
  console.log("");

  // ── Build execution plan ──────────────────────────────────────────────────
  const plan = buildExecutionPlan({
    executorAddress,
    mode,
    route: {
      chain: chainName,
      tokenIn,
      tokenOut,
      amountInRaw,
      minProfitTokenRaw: "0",
      minOutRaw,
      deadline,
      legs: encodedLegs,
    },
    gasLimit: 700_000,
  });

  console.log("routeHash:         ", plan.routeHash);
  console.log("outer selector:    ", plan.calldata.slice(0, 10));
  console.log("outer calldata len:", plan.calldata.length);
  console.log("");

  // ── Simulate ──────────────────────────────────────────────────────────────
  try {
    const result = await provider.call({
      to:   plan.target,
      data: plan.calldata,
    });

    console.log("✅ CAMELOT_SIMULATION_OK");
    console.log("returnDataLength:", result.length);
  } catch (error) {
    const decodedReason = decodeCommonRevert(error);

    const report = buildSimFailureReport({
      chain:          chainName,
      mode,
      executorTarget: plan.target,
      routeHash:      plan.routeHash,
      calldata:       plan.calldata,
      legTargets:     plan.targets,
      legPayloads:    plan.payloads,
      amountInRaw,
      minOutRaw,
      deadline,
      decodedReason,
    });

    console.error("❌ CAMELOT_SIMULATION_FAILED");
    console.error(JSON.stringify(report, null, 2));
    console.error("rawReason:", decodedReason);
    process.exit(2);
  }
}

main().catch((err) => {
  console.error("[validate-camelot-route] error:", err.message || err);
  process.exit(1);
});
