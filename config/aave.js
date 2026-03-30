function getAaveConfig(chainKey) {
  const key = String(chainKey || '').toLowerCase();

  if (key === 'polygon') {
    return {
      chainKey: 'polygon',
      // Aave V3 PoolAddressesProvider on Polygon PoS
      // https://polygonscan.com/address/0xa97684ead0e402dc232d5a977953df7ecbab3cdb
      poolAddressesProvider:
        process.env.AAVE_POOL_ADDRESSES_PROVIDER ||
        '0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb',
      // Aave V3 Pool on Polygon PoS
      // https://polygonscan.com/address/0x794a61358D6845594F94dc1DB02A252b5b4814aD
      pool: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
      // Native USDC (Circle) on Polygon PoS
      tokenIn:
        process.env.POLYGON_USDC ||
        '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
      // WETH on Polygon PoS
      tokenOut:
        process.env.POLYGON_WETH ||
        '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619',
      // Uniswap V3 SwapRouter02 on Polygon
      uniV3Router:
        process.env.POLYGON_UNIV3_ROUTER ||
        '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
      // SushiSwap router on Polygon
      sushiRouter:
        process.env.POLYGON_SUSHI_ROUTER ||
        '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506',
      // Wrapped Native (WPOL/WMATIC) on Polygon
      wrappedNative:
        process.env.POLYGON_WNATIVE ||
        '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
    };
  }

  // Arbitrum kept for reference
  if (key === 'arbitrum') {
    return {
      chainKey: 'arbitrum',
      poolAddressesProvider:
        process.env.AAVE_POOL_ADDRESSES_PROVIDER ||
        '0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb',
      pool: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
    };
  }

  throw new Error(`Unsupported Aave chain: ${chainKey}`);
}

module.exports = { getAaveConfig };
