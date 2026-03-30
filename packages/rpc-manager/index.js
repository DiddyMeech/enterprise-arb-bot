const { ethers } = require('ethers');

function splitList(value) {
  return String(value || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class ProviderBudget {
  constructor({
    url,
    lane = 'quote',
    maxRps = 5,
    burst = 5,
    timeoutMs = 4000,
    weight = 1
  }) {
    this.url = url;
    this.lane = lane;
    this.maxRps = maxRps;
    this.burst = burst;
    this.timeoutMs = timeoutMs;
    this.weight = weight;

    this.tokens = burst;
    this.lastRefill = Date.now();

    this.failures = 0;
    this.successes = 0;
    this.coolDownUntil = 0;
    this.lastUsedAt = 0;
    this.lastFailureAt = 0;
  }

  refill() {
    const now = Date.now();
    const elapsedMs = now - this.lastRefill;
    if (elapsedMs <= 0) return;
    const refillTokens = (elapsedMs / 1000) * this.maxRps;
    this.tokens = Math.min(this.burst, this.tokens + refillTokens);
    this.lastRefill = now;
  }

  isCoolingDown() {
    return Date.now() < this.coolDownUntil;
  }

  canSpend() {
    this.refill();
    return !this.isCoolingDown() && this.tokens >= 1;
  }

  spend() {
    this.refill();
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    this.lastUsedAt = Date.now();
    return true;
  }

  markSuccess() {
    this.successes += 1;
    this.failures = 0;
    this.coolDownUntil = 0;
  }

  markFailure(err) {
    this.failures += 1;
    this.lastFailureAt = Date.now();
    const msg = String(err?.message || err || '').toLowerCase();
    let cooldown;
    if (msg.includes('429'))     cooldown = 15000;
    else if (msg.includes('503')) cooldown = 7000;
    else if (msg.includes('timeout')) cooldown = 5000;
    else if (msg.includes('network')) cooldown = 4000;
    else cooldown = Math.min(10000, 1000 * this.failures);
    this.coolDownUntil = Date.now() + cooldown;
  }
}

class RpcManager {
  constructor({ chainKey, providers }) {
    if (!providers?.length) {
      throw new Error(`No providers configured for ${chainKey}`);
    }
    this.chainKey = chainKey;
    this.providers = providers.map((p) => new ProviderBudget(p));
    this._rr = 0;
  }

  static fromEnv(chainKey) {
    const upper = chainKey.toUpperCase();

    const quoteUrls = splitList(process.env[`${upper}_QUOTE_RPC_URLS`] || process.env[`${upper}_RPC_URLS`]);
    const simUrls   = splitList(process.env[`${upper}_SIM_RPC_URLS`]   || process.env[`${upper}_RPC_URLS`]);
    const sendUrls  = splitList(process.env[`${upper}_SEND_RPC_URLS`]  || process.env[`${upper}_RPC_URLS`]);

    const quoteRps = splitList(process.env[`${upper}_QUOTE_RPC_RPS`] || '');
    const simRps   = splitList(process.env[`${upper}_SIM_RPC_RPS`]   || '');
    const sendRps  = splitList(process.env[`${upper}_SEND_RPC_RPS`]  || '');

    const quoteProviders = quoteUrls.map((url, i) => ({
      url, lane: 'quote',
      maxRps:    num(quoteRps[i], 5),
      burst:     num(process.env.RPC_BURST_QUOTE, 5),
      timeoutMs: num(process.env.RPC_TIMEOUT_MS_QUOTE, 3000),
      weight:    3
    }));

    const simProviders = simUrls.map((url, i) => ({
      url, lane: 'sim',
      maxRps:    num(simRps[i], 3),
      burst:     num(process.env.RPC_BURST_SIM, 3),
      timeoutMs: num(process.env.RPC_TIMEOUT_MS_SIM, 4500),
      weight:    2
    }));

    const sendProviders = sendUrls.map((url, i) => ({
      url, lane: 'send',
      maxRps:    num(sendRps[i], 2),
      burst:     num(process.env.RPC_BURST_SEND, 2),
      timeoutMs: num(process.env.RPC_TIMEOUT_MS_SEND, 8000),
      weight:    5
    }));

    return new RpcManager({
      chainKey,
      providers: [...quoteProviders, ...simProviders, ...sendProviders]
    });
  }

  getCandidates(lane) {
    const candidates = this.providers.filter((p) => p.lane === lane);
    return candidates.length ? candidates : this.providers;
  }

  chooseProvider(lane) {
    const candidates = this.getCandidates(lane);
    const available  = candidates.filter((p) => p.canSpend());
    const pool       = available.length ? available : candidates.filter((p) => !p.isCoolingDown());
    if (!pool.length) return null;

    const weighted = [];
    for (const p of pool) {
      for (let i = 0; i < p.weight; i++) weighted.push(p);
    }
    const selected = weighted[this._rr % weighted.length];
    this._rr += 1;
    if (!selected.spend()) return null;

    const provider = new ethers.providers.JsonRpcProvider(selected.url);
    provider.__rpcMeta = selected;
    return provider;
  }

  async getProvider(lane = 'quote', waitMs = 2000) {
    const started = Date.now();
    while (Date.now() - started < waitMs) {
      const provider = this.chooseProvider(lane);
      if (provider) return provider;
      await sleep(50);
    }
    throw new Error(`No RPC provider available for lane=${lane} chain=${this.chainKey}`);
  }

  async withProvider(lane, fn, waitMs = 2000) {
    const provider = await this.getProvider(lane, waitMs);
    const meta = provider.__rpcMeta;
    try {
      const result = await Promise.race([
        fn(provider),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`RPC timeout after ${meta.timeoutMs}ms`)), meta.timeoutMs)
        )
      ]);
      meta.markSuccess();
      return result;
    } catch (err) {
      meta.markFailure(err);
      throw err;
    }
  }

  stats() {
    return this.providers.map((p) => ({
      url: p.url, lane: p.lane, maxRps: p.maxRps,
      failures: p.failures, successes: p.successes,
      coolDownUntil: p.coolDownUntil, tokens: Number(p.tokens.toFixed(2))
    }));
  }
}

module.exports = { RpcManager };
