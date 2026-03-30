const { ethers } = require('ethers');

function splitCsv(value) {
  return String(value || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

const CHAINS = {
  polygon: {
    key: 'polygon',
    chainId: 137,
    rpcUrl:
      process.env.POLYGON_RPC_URL ||
      process.env.RPC_URL_POLYGON ||
      process.env.MATIC_RPC_URL ||
      '',
    rpcs: splitCsv(process.env.POLYGON_RPC_URLS),
    wss: splitCsv(process.env.POLYGON_WSS_URLS),
    executorAddress:
      process.env.POLYGON_EXECUTOR_ADDRESS ||
      process.env.MATIC_CONTRACT_ADDRESS ||
      '',
    flashExecutorAddress:
      process.env.POLYGON_FLASH_EXECUTOR_ADDRESS ||
      process.env.MATIC_FLASH_EXECUTOR_ADDRESS ||
      '',
    explorerBaseUrl: 'https://polygonscan.com',
    tokens: {
      USDC: {
        symbol: 'USDC',
        // Native USDC on Polygon PoS
        address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
        decimals: 6
      },
      USDC_BRIDGED: {
        symbol: 'USDC.e',
        // Bridged USDC (more liquidity on older pools)
        address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
        decimals: 6
      },
      WETH: {
        symbol: 'WETH',
        address: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619',
        decimals: 18
      },
      WMATIC: {
        symbol: 'WMATIC',
        address: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
        decimals: 18
      }
    },
    dexes: {
      quickswap: {
        key: 'quickswap',
        kind: 'v2',
        // QuickSwap V2 router on Polygon
        router: '0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff',
        feeBps: 30
      },
      sushi: {
        key: 'sushi',
        kind: 'v2',
        // SushiSwap router on Polygon
        router: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506',
        feeBps: 30
      },
      univ3: {
        key: 'univ3',
        kind: 'v3',
        // Uniswap V3 SwapRouter02 on Polygon
        router: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
        // Uniswap V3 Quoter V2 on Polygon
        quoter: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
        fee: 500,
        feeBps: 5
      }
    }
  }
};

function getChain(chainKey) {
  const chain = CHAINS[String(chainKey || '').toLowerCase()];
  if (!chain) throw new Error(`Unsupported chain: ${chainKey}`);
  return chain;
}

function getToken(chainKey, symbol) {
  const chain = getChain(chainKey);
  const token = chain.tokens[String(symbol || '').toUpperCase()];
  if (!token) throw new Error(`Unsupported token ${symbol} on ${chainKey}`);
  return token;
}

function getDex(chainKey, dexKey) {
  const chain = getChain(chainKey);
  const dex = chain.dexes[String(dexKey || '').toLowerCase()];
  if (!dex) throw new Error(`Unsupported dex ${dexKey} on ${chainKey}`);
  return dex;
}

function makeProvider(chainKey) {
  const chain = getChain(chainKey);
  const url = chain.rpcUrl || chain.rpcs?.[0];
  if (!url) throw new Error(`Missing RPC URL for ${chainKey}`);
  return new ethers.providers.JsonRpcProvider(url);
}

module.exports = {
  CHAINS,
  getChain,
  getToken,
  getDex,
  makeProvider
};
