require('dotenv').config();
require('@nomicfoundation/hardhat-toolbox');

const polygonRpc =
  (process.env.POLYGON_SEND_RPC_URLS || '').split(',').map(v => v.trim()).filter(Boolean)[0] ||
  process.env.POLYGON_RPC_URL ||
  'https://polygon-rpc.com';

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
    polygon: {
      url: polygonRpc,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      chainId: 137
    }
  },
  paths: {
    sources: './contracts',
    tests: './test',
    cache: './cache',
    artifacts: './artifacts'
  }
};
