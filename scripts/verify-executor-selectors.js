#!/usr/bin/env node

const { ethers } = require("ethers");
const config = require("@arb/config");
const {
  EXECUTOR_ABI,
  getSelector,
} = require("@arb/trade-decision-engine");

function getChain(name) {
  const chain = Object.values(config.CHAINS).find((c) => c.name === name);
  if (!chain) {
    throw new Error(`Unknown chain: ${name}`);
  }
  if (!chain.rpcs?.length) {
    throw new Error(`No RPC configured for chain: ${name}`);
  }
  return chain;
}

async function main() {
  const chainName = process.argv[2] || "arbitrum";
  const chain = getChain(chainName);
  const provider = new ethers.providers.JsonRpcProvider(chain.rpcs[0]);
  const executor = chain.contractAddress || config.ARB_CONTRACT_ADDRESS;

  if (!executor) {
    throw new Error(`No executor address configured for ${chainName}`);
  }

  const iface = new ethers.utils.Interface(EXECUTOR_ABI);
  const code = await provider.getCode(executor);

  console.log("=== EXECUTOR SELECTOR VERIFY ===");
  console.log("chain:", chainName);
  console.log("executor:", executor);
  console.log("hasCode:", code && code !== "0x");
  console.log("codeSizeBytes:", code === "0x" ? 0 : (code.length - 2) / 2);
  console.log("");

  const walletSelector = getSelector("wallet");
  const flashSelector = getSelector("flash");

  console.log("local wallet selector:", walletSelector);
  console.log("local flash selector: ", flashSelector);
  console.log("");

  for (const frag of Object.values(iface.functions)) {
    const sighash = iface.getSighash(frag);
    console.log("abi function:", frag.format(), "->", sighash);
  }

  console.log("");
  console.log("If hasCode=false, stop there.");
  console.log("If selectors are wrong, fix executor-abi.ts before anything else.");
}

main().catch((err) => {
  console.error("[verify-executor-selectors] failed:", err);
  process.exit(1);
});
