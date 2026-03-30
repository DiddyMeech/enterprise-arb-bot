require('dotenv').config();
const hre = require('hardhat');
const { getAaveConfig } = require('../config/aave');

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const chainKey = process.env.ACTIVE_DEPLOY_CHAIN || 'arbitrum';
  const aave = getAaveConfig(chainKey);

  if (!aave.poolAddressesProvider) {
    throw new Error('Missing AAVE_POOL_ADDRESSES_PROVIDER');
  }

  console.log('[deploy] network=', chainKey);
  console.log('[deploy] deployer=', deployer.address);
  console.log('[deploy] provider=', aave.poolAddressesProvider);

  const TitanArbitrageExecutor = await hre.ethers.getContractFactory('TitanArbitrageExecutor');
  const contract = await TitanArbitrageExecutor.deploy(
    aave.poolAddressesProvider,
    deployer.address
  );

  await contract.deployed();

  console.log('[deploy] TitanArbitrageExecutor=', contract.address);
}

main().catch((err) => {
  console.error('[deploy] fatal', err);
  process.exit(1);
});
