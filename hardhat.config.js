require('dotenv').config();
require('@nomicfoundation/hardhat-toolbox');

const arbitrumRpc =
  (process.env.ARBITRUM_SEND_RPC_URLS || '').split(',').map(v => v.trim()).filter(Boolean)[0] ||
  process.env.ARBITRUM_RPC_URL ||
  'https://arb1.arbitrum.io/rpc';

module.exports = {
  solidity: {
    version: '0.8.20',
    settings: {
      optimizer: {
        enabled: true,
        runs: 500
      }
    }
  },
  networks: {
    arbitrum: {
      url: arbitrumRpc,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      chainId: 42161
    }
  },
  paths: {
    sources: './contracts',
    tests: './test',
    cache: './cache',
    artifacts: './artifacts'
  }
};
