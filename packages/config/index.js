require("dotenv").config();

function required(name, fallback = "") {
  return process.env[name] || fallback;
}

function splitCsv(name) {
  return (process.env[name] || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

const SAFE_MODE =
  String(process.env.SAFE_MODE || "true").toLowerCase() === "true";

function normalizeChain(chain) {
  return {
    ...chain,
    tokens: Object.fromEntries(
      Object.entries(chain.tokens || {}).map(([symbol, value]) => [
        symbol,
        typeof value === "string" ? { address: value } : value,
      ])
    ),
    dexes: Object.fromEntries(
      Object.entries(chain.routers || chain.dexes || {}).map(([name, value]) => [
        name,
        typeof value === "string" ? { router: value } : value,
      ])
    ),
  };
}

const CHAINS = {
  POLYGON: normalizeChain({
    name: "polygon",
    chainId: 137,
    rpcs: [
      ...splitCsv("POLYGON_RPC_URLS"),
      ...splitCsv("POLYGON_QUOTE_RPC_URLS"),
      required("POLYGON_RPC_URL"),
      required("ARB_RPC_EXEC"),
      required("ARB_RPC_SCAN"),
    ].filter(Boolean),
    scanRpcs: [
      ...splitCsv("POLYGON_QUOTE_RPC_URLS"),
      required("ARB_RPC_SCAN"),
    ].filter(Boolean),
    sendRpcs: [
      ...splitCsv("POLYGON_SEND_RPC_URLS"),
      required("ARB_RPC_EXEC"),
    ].filter(Boolean),
    flashExecutorAddress:
      process.env.POLYGON_FLASH_EXECUTOR_ADDRESS ||
      process.env.MATIC_FLASH_EXECUTOR_ADDRESS ||
      process.env.ARB_FLASH_EXECUTOR_ADDRESS ||
      "",
    executorAddress: process.env.ARB_CONTRACT_ADDRESS || "",
    tokens: {
      USDC: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
      USDC_BRIDGED: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
      WETH: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619",
      WMATIC: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270",
    },
    routers: {
      quickswap: "0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff",
      sushi: "0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506",
      univ3: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45",
    },
    aave: {
      poolAddressesProvider:
        process.env.AAVE_POOL_ADDRESSES_PROVIDER ||
        "0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb",
      pool: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
    },
    pollingInterval: 800,
  }),

  ARBITRUM: normalizeChain({
    name: "arbitrum",
    chainId: 42161,
    rpcs: [
      ...splitCsv("ARB_RPC_NODES"),
      required("ARB_RPC_EXEC"),
      required("ARB_RPC_SCAN"),
      required("ARB_RPC_CONF"),
    ].filter(Boolean),
    scanRpcs: [
      ...splitCsv("ARB_RPC_NODES"),
      required("ARB_RPC_EXEC"),
    ].filter(Boolean),
    mevRelay: process.env.ARB_MEV_RELAY || "",
    executorAddress: process.env.ARB_CONTRACT_ADDRESS || "",
    pollingInterval: 1000,
    tokens: {},
    routers: {},
  }),

  BASE: normalizeChain({
    name: "base",
    chainId: 8453,
    rpcs: [
      ...splitCsv("BASE_RPC_NODES"),
      required("BASE_RPC_EXEC"),
      required("BASE_RPC_SCAN"),
      required("BASE_RPC_CONF"),
    ].filter(Boolean),
    scanRpcs: [
      ...splitCsv("BASE_RPC_NODES"),
      required("BASE_RPC_EXEC"),
    ].filter(Boolean),
    mevRelay: process.env.BASE_MEV_RELAY || "",
    executorAddress: process.env.BASE_CONTRACT_ADDRESS || "",
    pollingInterval: 1000,
    tokens: {},
    routers: {},
  }),
};

function getChain(chainKey) {
  const key = String(chainKey || process.env.ACTIVE_DEPLOY_CHAIN || "polygon").toUpperCase();
  const chain = CHAINS[key];
  if (!chain) {
    throw new Error(`Unsupported chain: ${chainKey}`);
  }
  return chain;
}

module.exports = {
  SAFE_MODE,
  PRIVATE_KEY: required("PRIVATE_KEY", ""),
  MIN_PROFIT_USD: Number(
    process.env.MIN_NET_PROFIT_USD || process.env.MIN_PROFIT_USD || 5
  ),
  ARB_CONTRACT_ADDRESS: process.env.ARB_CONTRACT_ADDRESS || "",
  CHAINS,
  getChain,
};
