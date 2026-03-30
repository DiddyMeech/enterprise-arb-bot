function getAaveConfig(chainKey) {
  const key = String(chainKey || '').toLowerCase();

  if (key === 'arbitrum') {
    return {
      chainKey: 'arbitrum',
      // Set this from env so you can swap to official Address Book values cleanly.
      // Aave recommends resolving Pool through PoolAddressesProvider.
      poolAddressesProvider:
        process.env.AAVE_POOL_ADDRESSES_PROVIDER || '',
    };
  }

  throw new Error(`Unsupported Aave chain: ${chainKey}`);
}

module.exports = {
  getAaveConfig
};
