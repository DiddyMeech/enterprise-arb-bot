'use strict';
const { ethers }         = require('ethers');
const { getChain, getDex, getToken } = require('../../config/chains');
const { THRESHOLDS }     = require('../../config/thresholds');
const { SushiV2Adapter } = require('./sushi');
const { UniV3Adapter }   = require('./univ3');

// ── Provider counter for round-robin ─────────────────────────────────────────
const _rpcCounters = {};
function _nextRpc(pool, key) {
  _rpcCounters[key] = ((_rpcCounters[key] || 0) + 1) % pool.length;
  return pool[_rpcCounters[key]];
}

function makeScanProvider(chainName) {
  const chain = getChain(chainName);
  const pool  = chain.scanRpcs.length ? chain.scanRpcs : chain.rpcs;
  if (!pool.length) throw new Error(`No scan RPC for ${chainName}`);
  const url = _nextRpc(pool, chainName + ':scan');
  return new ethers.providers.StaticJsonRpcProvider(url, { chainId: chain.chainId, name: chainName });
}

function makeDexAdapters(chainName, provider) {
  const chain = getChain(chainName);
  const adapters = {};
  for (const [dexName, cfg] of Object.entries(chain.dexes)) {
    if (cfg.kind === 'v2') {
      adapters[dexName] = new SushiV2Adapter(cfg.router, provider);
    } else if (cfg.kind === 'v3') {
      adapters[dexName] = new UniV3Adapter(cfg.router, cfg.quoter, provider, cfg.fee);
    }
  }
  return adapters;
}

// Re-export named adapters and legacy base class for backward compat
const { BaseDexAdapter, UniswapV3Adapter } = require('./index_legacy');

module.exports = {
  SushiV2Adapter,
  UniV3Adapter,
  BaseDexAdapter,
  UniswapV3Adapter,
  makeScanProvider,
  makeDexAdapters,
};
