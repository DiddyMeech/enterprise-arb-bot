require('dotenv').config();
require('@nomicfoundation/hardhat-toolbox');

const polygonRpcCandidates = [
  ...(process.env.POLYGON_SEND_RPC_URLS || '').split(',').map(v => v.trim()).filter(Boolean),
  process.env.POLYGON_RPC_URL,
  'https://polygon-mainnet.infura.io/v3/86d56ef25fa3495fb9e2f70f0d5ddc49',
  'https://polygon-mainnet.g.alchemy.com/v2/1GyaWdstqAQDyIWjedYVRtxZu106iVG5',
  'https://polygon-mainnet.g.alchemy.com/v2/Ax6RTJWLckAgyXFB2JshrhLrLXmxeI6j',
  'https://polygon-rpc.com',
].filter(Boolean);

// Use second URL (skip first which was disabled), fall back to public
const polygonRpc = polygonRpcCandidates[1] || polygonRpcCandidates[0] || 'https://polygon-rpc.com';

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
