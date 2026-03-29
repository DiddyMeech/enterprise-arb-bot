/**
 * arb-scanner/index.js — Phase 15 wiring (price-poll edition)
 *
 * Polls Sushi V2 and UniV3 USDC/WETH prices every POLL_INTERVAL_MS.
 * When prices diverge >= DIVERGENCE_THRESHOLD_BPS, emits a normalized
 * Opportunity to ArbOrchestrator.submitOpportunity() in shadow mode.
 *
 * Also scans blocks for heartbeat visibility (no tx decoding required).
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const { ethers } = require('ethers');
const { randomUUID } = require('crypto');
const config = require('@arb/config');

// ── Constants ────────────────────────────────────────────────────────────────
const USDC_ARB  = '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8';
const WETH_ARB  = '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1';
const USDC_BASE = '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA';
const WETH_BASE = '0x4200000000000000000000000000000000000006';

const SUSHI_ROUTER_ARB  = '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506';
const SUSHI_ROUTER_BASE = '0x327Df1E6de05B9A098E56B0868f7b52044458dE7';

// UniV3 USDC/WETH 0.05% pool on Arbitrum (highest volume)
const UNIV3_QUOTER_ARB  = '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6'; // QuoterV1
const UNIV3_POOL_FEE    = 500; // 0.05%

const POLL_INTERVAL_MS           = 3000;   // poll every 3 seconds
const DIVERGENCE_THRESHOLD_BPS   = 10;     // emit if >= 10 bps (0.10%) divergence
const PROBE_AMOUNT_USDC          = '10000000'; // 10 USDC (6 decimals) probe quote
const ETH_PRICE_USD_HINT         = 2200;

// ── Helpers ──────────────────────────────────────────────────────────────────
const SUSHI_IFACE = new ethers.utils.Interface([
  'function getAmountsOut(uint amountIn, address[] path) view returns (uint[] amounts)',
]);
const UNIV3_QUOTER_IFACE = new ethers.utils.Interface([
  'function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external returns (uint256 amountOut)',
]);

// ── Dedupe cache ─────────────────────────────────────────────────────────────
const dedupeCache = new Map();
const DEDUPE_TTL_MS = 5000;

function isDuplicate(key) {
  const exp = dedupeCache.get(key);
  if (exp && exp > Date.now()) return true;
  dedupeCache.set(key, Date.now() + DEDUPE_TTL_MS);
  return false;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, exp] of dedupeCache) if (exp <= now) dedupeCache.delete(k);
}, 30_000);

// ── Provider factory ─────────────────────────────────────────────────────────
function chainCfg(name) {
  return Object.values(config.CHAINS).find(c => c.name === name);
}

function makeProvider(name) {
  const cfg = chainCfg(name);
  if (!cfg || !cfg.rpcs?.length) throw new Error(`No RPC for ${name}`);
  // Round-robin using Date for variety
  const idx = Math.floor(Date.now() / 10000) % cfg.rpcs.length;
  return new ethers.providers.StaticJsonRpcProvider(cfg.rpcs[idx], { chainId: cfg.chainId, name });
}

// ── Lazy orchestrator ─────────────────────────────────────────────────────────
let orchPromise = null;
async function getOrchestrator() {
  if (orchPromise) return orchPromise;
  orchPromise = (async () => {
    const {
      ArbOrchestrator,
      ORCHESTRATOR_CONFIG,
      EngineLogger,
      buildExecutionPlan,
      normalizeRoute,
      encodeDexLeg,
      decodeCommonRevert,
    } = require('@arb/trade-decision-engine');

    const logger = new EngineLogger({ service: 'arb-scanner', minLevel: 'info', json: true });

    async function quoteExactRoute(opp, amountInUsd) {
      try {
        const provider = makeProvider(opp.chain);
        const cfg = chainCfg(opp.chain);
        const usdcAddr = opp.chain === 'arbitrum' ? USDC_ARB : USDC_BASE;
        const wethAddr = opp.chain === 'arbitrum' ? WETH_ARB : WETH_BASE;
        const sushiRouter = opp.chain === 'arbitrum' ? SUSHI_ROUTER_ARB : SUSHI_ROUTER_BASE;

        const isUsdcIn = opp.tokenIn === 'USDC';
        const tokenInAddr  = isUsdcIn ? usdcAddr : wethAddr;
        const tokenOutAddr = isUsdcIn ? wethAddr : usdcAddr;
        const inDecimals   = isUsdcIn ? 6 : 18;

        const amountInRaw = ethers.utils.parseUnits(String(Math.round(amountInUsd)), inDecimals);
        const sushi = new ethers.Contract(sushiRouter, SUSHI_IFACE, provider);
        const amounts = await sushi.getAmountsOut(amountInRaw, [tokenInAddr, tokenOutAddr]);

        const outDecimals    = isUsdcIn ? 18 : 6;
        const outUsd         = parseFloat(ethers.utils.formatUnits(amounts[1], outDecimals)) * (isUsdcIn ? ETH_PRICE_USD_HINT : 1);
        const grossProfitUsd = outUsd - amountInUsd;

        if (grossProfitUsd <= 0) return { ok: false, reason: 'NO_PROFIT' };

        return {
          ok: true,
          grossProfitUsd: Math.max(0, grossProfitUsd),
          gasUsd: opp.chain === 'arbitrum' ? 1.8 : 1.2,
          dexFeesUsd: amountInUsd * 0.003,
          flashLoanFeeUsd: 0,
          amountOutRaw: amounts[1].toString(),
          route: { chain: opp.chain, legs: [], amountInUsd, expectedGrossProfitUsd: grossProfitUsd },
        };
      } catch (e) { return { ok: false, reason: `QUOTE_ERROR: ${e.message}` }; }
    }

    async function simulateExactExecution(input) {
      try {
        const provider = makeProvider(input.opp.chain);
        const cfg2 = chainCfg(input.opp.chain);
        const executorAddress = cfg2?.contractAddress || config.ARB_CONTRACT_ADDRESS;
        if (!executorAddress) return { ok: false, mode: input.mode, decodedReason: 'NO_EXECUTOR' };

        const usdcAddr = input.opp.chain === 'arbitrum' ? USDC_ARB : USDC_BASE;
        const wethAddr = input.opp.chain === 'arbitrum' ? WETH_ARB : WETH_BASE;
        const router   = input.opp.chain === 'arbitrum' ? SUSHI_ROUTER_ARB : SUSHI_ROUTER_BASE;
        const isUsdcIn = input.opp.tokenIn === 'USDC';
        const tokenInAddr  = isUsdcIn ? usdcAddr : wethAddr;
        const tokenOutAddr = isUsdcIn ? wethAddr : usdcAddr;
        const inDecimals   = isUsdcIn ? 6 : 18;
        const amountInRaw  = ethers.utils.parseUnits(String(Math.round(input.amountInUsd)), inDecimals).toString();
        const deadline     = Math.floor(Date.now() / 1000) + 60;

        let leg2AmountInRaw = amountInRaw;
        try {
          const sushi = new ethers.Contract(router, SUSHI_IFACE, provider);
          const amounts = await sushi.getAmountsOut(amountInRaw, [tokenInAddr, tokenOutAddr]);
          leg2AmountInRaw = amounts[1].toString();
        } catch { /* use fallback */ }

        const normalized = normalizeRoute({
          deadline,
          legs: [
            { dex: 'sushi', router, tokenIn: tokenInAddr, tokenOut: tokenOutAddr, recipient: executorAddress, amountInRaw, minOutRaw: '1' },
            { dex: 'sushi', router, tokenIn: tokenOutAddr, tokenOut: tokenInAddr, recipient: executorAddress, amountInRaw: leg2AmountInRaw, minOutRaw: '1' },
          ],
        });

        const encodedLegs = normalized.map(l => encodeDexLeg(l));
        const plan = buildExecutionPlan({
          executorAddress, mode: input.mode,
          route: { chain: input.opp.chain, tokenIn: tokenInAddr, tokenOut: tokenInAddr, amountInRaw, minProfitTokenRaw: '0', minOutRaw: '1', deadline, legs: encodedLegs },
        });

        await provider.call({ to: plan.target, data: plan.calldata });
        return { ok: true, mode: input.mode };
      } catch (err) {
        return { ok: false, mode: input.mode, decodedReason: decodeCommonRevert(err) };
      }
    }

    const orch = new ArbOrchestrator(
      ORCHESTRATOR_CONFIG,
      {
        quoteExactRoute,
        simulateExactExecution,
        sendExecution: async () => ({ ok: false, error: 'SHADOW_MODE_NO_SEND' }),
        waitForReceipt: async (txHash) => ({ ok: false, txHash, error: 'SHADOW_MODE' }),
        persistReplay: async (record) => {
          if (record.phase === 'simulate' && record.evaluation?.ok) {
            console.log(JSON.stringify({ event: 'SHADOW_WOULD_EXECUTE', chain: record.opportunity?.chain, id: record.opportunity?.id, net: record.evaluation?.netProfitUsd }));
          }
        },
        log: (msg, payload) => logger.info('LEARN_UPDATE', { msg, payload }),
      },
      logger,
    );
    orch.startBackgroundTasks();
    console.log('[ORCH] New orchestrator active — shadow mode ✅');
    return orch;
  })();
  return orchPromise;
}

// ── Price poller ─────────────────────────────────────────────────────────────
class PricePoller {
  constructor(chainName) {
    this.chain = chainName;
    this.cfg   = chainCfg(chainName);
    if (!this.cfg) return;
    this.sushiRouter  = chainName === 'arbitrum' ? SUSHI_ROUTER_ARB  : SUSHI_ROUTER_BASE;
    this.usdcAddr     = chainName === 'arbitrum' ? USDC_ARB           : USDC_BASE;
    this.wethAddr     = chainName === 'arbitrum' ? WETH_ARB           : WETH_BASE;
    this.quoter       = chainName === 'arbitrum' ? UNIV3_QUOTER_ARB   : null;
    console.log(`[SCANNER] [PRICE-POLL] Starting on ${chainName} every ${POLL_INTERVAL_MS}ms`);
    setInterval(() => this.poll(), POLL_INTERVAL_MS);
  }

  async poll() {
    try {
      const provider = makeProvider(this.chain);
      const probeRaw = PROBE_AMOUNT_USDC;

      // Sushi quote: USDC → WETH
      const sushi   = new ethers.Contract(this.sushiRouter, SUSHI_IFACE, provider);
      const sushiOut = await sushi.getAmountsOut(probeRaw, [this.usdcAddr, this.wethAddr]);
      const sushiWethOut = BigInt(sushiOut[1].toString());

      // UniV3 quote: USDC → WETH (only on Arbitrum for now)
      if (!this.quoter) return;
      const quoter   = new ethers.Contract(this.quoter, UNIV3_QUOTER_IFACE, provider);
      const univ3Out = await quoter.callStatic.quoteExactInputSingle(
        this.usdcAddr, this.wethAddr, UNIV3_POOL_FEE, probeRaw, 0
      );
      const univ3WethOut = BigInt(univ3Out.toString());

      if (sushiWethOut === 0n || univ3WethOut === 0n) return;

      // Divergence in bps = |A - B| / max(A,B) * 10000
      const diff = sushiWethOut > univ3WethOut
        ? sushiWethOut - univ3WethOut
        : univ3WethOut - sushiWethOut;
      const maxOut = sushiWethOut > univ3WethOut ? sushiWethOut : univ3WethOut;
      const divBps = Number((diff * 10000n) / maxOut);

      if (divBps < DIVERGENCE_THRESHOLD_BPS) return;

      // At 44 bps on $500 = $2.20 gross, above $1.80 gas threshold
      const tradeUsdHint = 500;
      const dedupeKey = `${this.chain}:${tokenIn}:${tokenOut}:${Math.floor(divBps / 5)}`;
      if (isDuplicate(dedupeKey)) return;

      console.log(`[SCANNER] [PRICE-DIV] ${this.chain} | USDC/WETH | Sushi vs UniV3 divergence: ${divBps} bps | buyOnSushi=${buyOnSushi}`);

      const opp = {
        id: randomUUID(),
        chain: this.chain,
        tokenIn,
        tokenOut,
        dexBuy: buyOnSushi ? 'sushi' : 'univ3',
        dexSell: buyOnSushi ? 'univ3' : 'sushi',
        amountInUsdHint: tradeUsdHint,
        quotedGrossProfitUsd: tradeUsdHint * (divBps / 10000),
        estimatedGasUsd: 1.8,
        estimatedPriceImpactBps: divBps,
        minObservedPoolLiquidityUsd: 500_000,
        minObserved24hVolumeUsd: 1_000_000,
        routeHops: 2,
        blockNumberSeen: 0,
        currentBlockNumber: 0,
        quoteTimestampMs: Date.now(),
      };

      console.log(`[SCANNER] [→ORCH] ${opp.chain} | ${opp.tokenIn}→${opp.tokenOut} | divBps=${divBps} | id: ${opp.id.slice(0,8)}`);
      const orch = await getOrchestrator();
      orch.submitOpportunity(opp);
    } catch (err) {
      // Log only first few chars to avoid log spam from RPC errors
      console.error(`[SCANNER] Poll error on ${this.chain}: ${err.message?.slice(0, 120)}`);
    }
  }
}

// ── Block scanner (heartbeat only) ───────────────────────────────────────────
class ScannerApp {
  constructor() {
    this.chains = config.CHAINS;
    console.log('[SCANNER] Initializing multi-chain price-poll arb detector');
  }

  start() {
    // Warm up orchestrator on startup
    getOrchestrator().catch(err => console.error('[SCANNER] Orchestrator init error:', err.message));

    for (const chain of Object.values(this.chains)) {
      if (chain.name === 'optimism') continue;

      // Heartbeat block poller
      if (chain.pollingInterval) this.startPolling(chain);

      // Price divergence poller
      new PricePoller(chain.name);
    }
  }

  startPolling(chain) {
    const providers = chain.rpcs.slice(0, 4).map(url =>
      new ethers.providers.StaticJsonRpcProvider(url, { chainId: chain.chainId, name: chain.name })
    );
    let pIndex = 0;
    let lastBlock = null;

    setInterval(async () => {
      try {
        const provider = providers[pIndex];
        pIndex = (pIndex + 1) % providers.length;
        const latest = await provider.getBlockNumber();
        if (lastBlock === null) { lastBlock = latest - 1; return; }
        if (latest <= lastBlock) return;
        const start = Math.max(lastBlock + 1, latest - 3);
        for (let b = start; b <= latest; b++) {
          const block = await provider.getBlock(b); // lightweight — no txs
          if (block) console.log(`[SCANNER] [HEARTBEAT] ${chain.name} | Block ${b} | gasPrice=${block.baseFeePerGas ? ethers.utils.formatUnits(block.baseFeePerGas, 'gwei').slice(0,5) : 'n/a'} gwei`);
        }
        lastBlock = latest;
      } catch (err) {
        console.error(`[SCANNER] Poll error on ${chain.name}: ${err.message?.slice(0, 100)}`);
      }
    }, chain.pollingInterval);
  }
}

new ScannerApp().start();
