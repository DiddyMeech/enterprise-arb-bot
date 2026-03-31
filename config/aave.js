function getAaveConfig(chainKey) {
  const key = String(chainKey || "").toLowerCase();

  if (key === "polygon") {
    return {
      chainKey: "polygon",
      poolAddressesProvider:
        process.env.AAVE_POOL_ADDRESSES_PROVIDER ||
        "0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb",
      pool: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
      tokenIn:
        process.env.POLYGON_USDC ||
        "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
      tokenOut:
        process.env.POLYGON_WETH ||
        "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619",
      uniV3Router:
        process.env.POLYGON_UNIV3_ROUTER ||
        "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45",
      sushiRouter:
        process.env.POLYGON_SUSHI_ROUTER ||
        "0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506",
      quickswapRouter:
        process.env.POLYGON_QUICKSWAP_ROUTER ||
        "0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff",
      wrappedNative:
        process.env.POLYGON_WNATIVE ||
        "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270",
    };
  }

  if (key === "arbitrum") {
    return {
      chainKey: "arbitrum",
      poolAddressesProvider:
        process.env.AAVE_POOL_ADDRESSES_PROVIDER ||
        "0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb",
      pool: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
    };
  }

  throw new Error(`Unsupported Aave chain: ${chainKey}`);
}

module.exports = { getAaveConfig };
