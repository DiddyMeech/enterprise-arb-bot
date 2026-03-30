require('dotenv').config();
const hre = require('hardhat');
const { getChain } = require('../config/chains');

async function main() {
  const chainKey = process.env.ACTIVE_DEPLOY_CHAIN || 'arbitrum';
  const chain = getChain(chainKey);

  const flashExecutorAddress =
    process.env.ARBITRUM_FLASH_EXECUTOR_ADDRESS ||
    process.env.ARB_FLASH_EXECUTOR_ADDRESS;

  if (!flashExecutorAddress) {
    throw new Error('Missing flash executor address');
  }

  const contract = await hre.ethers.getContractAt(
    'TitanArbitrageExecutor',
    flashExecutorAddress
  );

  const usdc = chain.tokens.USDC.address;
  const weth = chain.tokens.WETH.address;
  const sushi = chain.dexes.sushi.router;
  const univ3 = chain.dexes.univ3.router;

  console.log('[whitelist] contract=', flashExecutorAddress);

  await (await contract.setToken(usdc, true)).wait();
  console.log('[whitelist] token ok USDC', usdc);

  await (await contract.setToken(weth, true)).wait();
  console.log('[whitelist] token ok WETH', weth);

  await (await contract.setRouter(sushi, true)).wait();
  console.log('[whitelist] router ok sushi', sushi);

  await (await contract.setRouter(univ3, true)).wait();
  console.log('[whitelist] router ok univ3', univ3);
}

main().catch((err) => {
  console.error('[whitelist] fatal', err);
  process.exit(1);
});
