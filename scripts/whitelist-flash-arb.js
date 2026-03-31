require("dotenv").config();
const hre = require("hardhat");
const { getChain } = require("../packages/config");

async function main() {
  const chainKey = process.env.ACTIVE_DEPLOY_CHAIN || "polygon";
  const chain = getChain(chainKey);

  const flashExecutorAddress =
    process.env.POLYGON_FLASH_EXECUTOR_ADDRESS ||
    process.env.MATIC_FLASH_EXECUTOR_ADDRESS ||
    process.env.ARB_FLASH_EXECUTOR_ADDRESS;

  if (!flashExecutorAddress) {
    throw new Error(
      "Missing flash executor address (POLYGON_FLASH_EXECUTOR_ADDRESS)"
    );
  }

  const contract = await hre.ethers.getContractAt(
    "TitanArbitrageExecutor",
    flashExecutorAddress
  );

  const usdc = chain.tokens.USDC.address;
  const usdcBridged = chain.tokens.USDC_BRIDGED?.address;
  const weth = chain.tokens.WETH.address;
  const wmatic = chain.tokens.WMATIC?.address;

  const quickswap = chain.dexes.quickswap?.router;
  const sushi = chain.dexes.sushi?.router;
  const univ3 = chain.dexes.univ3?.router;

  console.log("[whitelist] contract=", flashExecutorAddress);

  await (await contract.setToken(usdc, true)).wait();
  console.log("[whitelist] token ok USDC", usdc);

  if (usdcBridged) {
    await (await contract.setToken(usdcBridged, true)).wait();
    console.log("[whitelist] token ok USDC.e", usdcBridged);
  }

  await (await contract.setToken(weth, true)).wait();
  console.log("[whitelist] token ok WETH", weth);

  if (wmatic) {
    await (await contract.setToken(wmatic, true)).wait();
    console.log("[whitelist] token ok WMATIC", wmatic);
  }

  if (quickswap) {
    await (await contract.setRouter(quickswap, true)).wait();
    console.log("[whitelist] router ok quickswap", quickswap);
  }

  if (sushi) {
    await (await contract.setRouter(sushi, true)).wait();
    console.log("[whitelist] router ok sushi", sushi);
  }

  if (univ3) {
    await (await contract.setRouter(univ3, true)).wait();
    console.log("[whitelist] router ok univ3", univ3);
  }
}

main().catch((err) => {
  console.error("[whitelist] fatal", err);
  process.exit(1);
});
