require('dotenv').config();
const hre = require('hardhat');
const { getAaveConfig } = require('../config/aave');

function requireAddress(name, value) {
  if (!value) {
    throw new Error(`[deploy] Missing ${name}`);
  }
  if (!hre.ethers.utils.isAddress(value)) {
    throw new Error(`[deploy] ${name} is not a valid EVM address: ${value}`);
  }
  return hre.ethers.utils.getAddress(value);
}

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const chainKey = process.env.ACTIVE_DEPLOY_CHAIN || 'polygon';
  const aave = getAaveConfig(chainKey);

  const poolAddressesProvider = requireAddress(
    'AAVE_POOL_ADDRESSES_PROVIDER',
    aave.poolAddressesProvider
  );

  console.log('[deploy] network=', chainKey);
  console.log('[deploy] deployer=', deployer.address);
  console.log('[deploy] provider=', poolAddressesProvider);

  const TitanArbitrageExecutor = await hre.ethers.getContractFactory('TitanArbitrageExecutor');
  const contract = await TitanArbitrageExecutor.deploy(
    poolAddressesProvider,
    deployer.address
  );
  await contract.deployed();

  console.log('[deploy] TitanArbitrageExecutor=', contract.address);
}
main().catch((err) => {
  console.error('[deploy] fatal', err);
  process.exit(1);
});
