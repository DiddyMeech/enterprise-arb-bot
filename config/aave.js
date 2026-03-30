function getAaveConfig(chainKey) {
  const key = String(chainKey || '').toLowerCase();

  if (key === 'polygon') {
    return {
      chainKey: 'polygon',
      // Aave V3 PoolAddressesProvider on Polygon PoS
      // Official address from Aave address book
      poolAddressesProvider:
        process.env.AAVE_POOL_ADDRESSES_PROVIDER || '0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb',
    };
  }

  // Kept for reference — Arbitrum provider address
  if (key === 'arbitrum') {
    return {
      chainKey: 'arbitrum',
      poolAddressesProvider:
        process.env.AAVE_POOL_ADDRESSES_PROVIDER || '0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb',
    };
  }

  throw new Error(`Unsupported Aave chain: ${chainKey}`);
}

module.exports = {
  getAaveConfig
};
