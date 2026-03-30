const { ethers } = require('ethers');

function splitList(value) {
  return String(value || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

class RpcManager {
  constructor({ chainKey, rpcUrls = [], wsUrls = [], pollMs = 250 }) {
    this.chainKey = chainKey;
    this.rpcUrls = rpcUrls;
    this.wsUrls = wsUrls;
    this.pollMs = pollMs;
    this.index = 0;
    this.health = new Map();

    if (!this.rpcUrls.length) {
      throw new Error(`No RPC URLs configured for ${chainKey}`);
    }

    for (const url of this.rpcUrls) {
      this.health.set(url, {
        failures: 0,
        lastFailureAt: 0,
        coolDownUntil: 0
      });
    }
  }

  static fromEnv(chainKey) {
    const upper = chainKey.toUpperCase();
    const rpcUrls = splitList(process.env[`${upper}_RPC_URLS`]);
    const wsUrls  = splitList(process.env[`${upper}_WSS_URLS`]);
    const pollMs  = Number(process.env.RPC_ROTATION_POLL_MS || '250');

    return new RpcManager({ chainKey, rpcUrls, wsUrls, pollMs });
  }

  markFailure(url) {
    const entry = this.health.get(url);
    if (!entry) return;
    entry.failures += 1;
    entry.lastFailureAt = Date.now();
    entry.coolDownUntil = Date.now() + Math.min(30000, 1000 * entry.failures);
  }

  markSuccess(url) {
    const entry = this.health.get(url);
    if (!entry) return;
    entry.failures = 0;
    entry.coolDownUntil = 0;
  }

  getHealthyRpcUrl() {
    const now = Date.now();
    const candidates = this.rpcUrls.filter((url) => {
      const entry = this.health.get(url);
      return !entry || entry.coolDownUntil <= now;
    });

    const source = candidates.length ? candidates : this.rpcUrls;
    const url = source[this.index % source.length];
    this.index += 1;
    return url;
  }

  getProvider() {
    const url = this.getHealthyRpcUrl();
    const provider = new ethers.providers.JsonRpcProvider(url);
    provider.__rpcUrl = url;
    return provider;
  }

  async withProvider(fn) {
    const provider = this.getProvider();
    try {
      const out = await fn(provider);
      this.markSuccess(provider.__rpcUrl);
      return out;
    } catch (err) {
      this.markFailure(provider.__rpcUrl);
      throw err;
    }
  }
}

module.exports = { RpcManager };
