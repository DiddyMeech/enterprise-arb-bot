const { ethers } = require('ethers');

function splitCsv(value) {
  return String(value || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

const CHAINS = {
  arbitrum: {
    key: 'arbitrum',
    chainId: 42161,
    rpcUrl:
      process.env.ARBITRUM_RPC_URL ||
      process.env.RPC_URL_ARBITRUM ||
      process.env.ARB_RPC_URL ||
      '',
    rpcs: splitCsv(process.env.ARBITRUM_RPC_URLS),
    wss: splitCsv(process.env.ARBITRUM_WSS_URLS),
    executorAddress:
      process.env.ARBITRUM_EXECUTOR_ADDRESS ||
      process.env.ARB_CONTRACT_ADDRESS ||
      '',
    flashExecutorAddress:
      process.env.ARBITRUM_FLASH_EXECUTOR_ADDRESS ||
      process.env.ARB_FLASH_EXECUTOR_ADDRESS ||
      '',
    explorerBaseUrl: 'https://arbiscan.io',
    tokens: {
      USDC: {
        symbol: 'USDC',
        address: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8',
        decimals: 6
      },
      WETH: {
        symbol: 'WETH',
        address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
        decimals: 18
      }
    },
    dexes: {
      sushi: {
        key: 'sushi',
        kind: 'v2',
        router: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506',
        feeBps: 30
      },
      univ3: {
        key: 'univ3',
        kind: 'v3',
        router: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
        quoter: '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6',
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
