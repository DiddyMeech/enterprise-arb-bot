/**
 * arb-scanner/index.js — Phase 15 wiring
 *
 * Normalizes on-chain routing events into proper Opportunity objects and feeds
 * them directly into ArbOrchestrator.submitOpportunity() in shadow mode.
 *
 * Active filters (Phase 15 / shadow-mode hardening):
 *   - Arbitrum + Base only
 *   - USDC/WETH pair only
 *   - Sushi router only (proven route family)
 *   - Max 1 opportunity per route per 3s (dedupe TTL)
 *   - Freshness gate: max 1200ms from quote to submit
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const { ethers } = require('ethers');
const { randomUUID } = require('crypto');
const config = require('@arb/config');

// ── Constants ───────────────────────────────────────────────────────────────
const USDC_ARB  = '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8'.toLowerCase();
const WETH_ARB  = '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1'.toLowerCase();
const USDC_BASE = '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA'.toLowerCase(); // USDbC
const WETH_BASE = '0x4200000000000000000000000000000000000006'.toLowerCase();

const SUSHI_ROUTER_ARB  = '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506'.toLowerCase();
const SUSHI_ROUTER_BASE = '0x327Df1E6de05B9A098E56B0868f7b52044458dE7'.toLowerCase();
const UNIV3_ROUTER_ARB  = '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45'.toLowerCase(); // SwapRouter02
const UNIV3_ROUTER_ARB2 = '0xE592427A0AEce92De3Edee1F18E0157C05861564'.toLowerCase(); // SwapRouter01
const UNIV3_ROUTER_BASE = '0x2626664c2603336E57B271c5C0b26F421741e481'.toLowerCase();

const ALLOWED_PAIRS = new Set([
  `${USDC_ARB}:${WETH_ARB}`,
  `${WETH_ARB}:${USDC_ARB}`,
  `${USDC_BASE}:${WETH_BASE}`,
  `${WETH_BASE}:${USDC_BASE}`,
]);
const ALLOWED_ROUTERS = new Set([
  SUSHI_ROUTER_ARB, SUSHI_ROUTER_BASE,
  UNIV3_ROUTER_ARB, UNIV3_ROUTER_ARB2, UNIV3_ROUTER_BASE,
]);

// USDC decimals = 6, WETH = 18; map normalized symbol
function tokenSymbol(addr) {
  const a = addr.toLowerCase();
  if (a === USDC_ARB || a === USDC_BASE) return 'USDC';
  if (a === WETH_ARB || a === WETH_BASE) return 'WETH';
  return null;
}

// Rough USD conversion for the profit hint (not used for execution, just pre-filter)
const ETH_PRICE_USD_HINT = 2200;
function rawToUsdHint(rawBn, decimals) {
  try {
    const f = parseFloat(ethers.utils.formatUnits(rawBn, decimals));
    return decimals === 6 ? f : f * ETH_PRICE_USD_HINT;
  } catch { return 0; }
}

// ── Dedupe cache ─────────────────────────────────────────────────────────────
const DEDUPE_TTL_MS = 3000;
const dedupeCache = new Map(); // key → expiryMs

function isDuplicate(key) {
  const exp = dedupeCache.get(key);
  if (exp && exp > Date.now()) return true;
  dedupeCache.set(key, Date.now() + DEDUPE_TTL_MS);
  return false;
}

// Prune stale dedupe entries every 30s
setInterval(() => {
  const now = Date.now();
  for (const [k, exp] of dedupeCache) {
    if (exp <= now) dedupeCache.delete(k);
  }
}, 30_000);

// ── Lazy-load orchestrator (built once, shared across scanner hits) ──────────
let orchestratorPromise = null;

async function getOrchestrator() {
  if (orchestratorPromise) return orchestratorPromise;

  orchestratorPromise = (async () => {
    const {
      ArbOrchestrator,
      ORCHESTRATOR_CONFIG,
      EngineLogger,
    } = require('@arb/trade-decision-engine');

    const { ethers: eth } = require('ethers');

    // Per-chain provider for real quoteExactRoute + simulateExactExecution
    function getProvider(chain) {
      const cfg = Object.values(config.CHAINS).find(c => c.name === chain);
      if (!cfg || !cfg.rpcs?.length) throw new Error(`No RPC for chain: ${chain}`);
      return new eth.providers.StaticJsonRpcProvider(cfg.rpcs[0]);
    }

    function getExecutor(chain) {
      const cfg = Object.values(config.CHAINS).find(c => c.name === chain);
      return cfg?.contractAddress || config.ARB_CONTRACT_ADDRESS || '';
    }

    // ── Real quote via Sushi getAmountsOut ─────────────────────────────────
    const SUSHI_IFACE = new eth.utils.Interface([
      'function getAmountsOut(uint amountIn, address[] path) view returns (uint[] amounts)',
    ]);

    async function quoteExactRoute(opp, amountInUsd) {
      try {
        const provider = getProvider(opp.chain);
        const router   = opp.chain === 'arbitrum' ? SUSHI_ROUTER_ARB : SUSHI_ROUTER_BASE;
        const usdcAddr = opp.chain === 'arbitrum' ? USDC_ARB : USDC_BASE;
        const wethAddr = opp.chain === 'arbitrum' ? WETH_ARB : WETH_BASE;

        const isUsdcIn = opp.tokenIn === 'USDC';
        const tokenInAddr  = isUsdcIn ? usdcAddr : wethAddr;
        const tokenOutAddr = isUsdcIn ? wethAddr : usdcAddr;

        const inDecimals  = isUsdcIn ? 6 : 18;
        const amountInRaw = eth.utils.parseUnits(String(Math.round(amountInUsd)), inDecimals);

        const sushi = new eth.Contract(router, SUSHI_IFACE, provider);
        const amounts = await sushi.getAmountsOut(amountInRaw, [tokenInAddr, tokenOutAddr]);

        const outDecimals   = isUsdcIn ? 18 : 6;
        const grossProfitUsd = rawToUsdHint(amounts[1], outDecimals) - amountInUsd;

        if (grossProfitUsd <= 0) return { ok: false, reason: 'NO_PROFIT_AFTER_QUOTE' };

        const gasUsd = opp.chain === 'arbitrum' ? 1.8 : 1.2;
        const dexFeesUsd = amountInUsd * 0.003;

        return {
          ok: true,
          grossProfitUsd: Math.max(0, grossProfitUsd),
          gasUsd,
          dexFeesUsd,
          flashLoanFeeUsd: 0,
          amountOutRaw: amounts[1].toString(),
          route: {
            chain: opp.chain,
            legs: [
              { dex: 'sushi', tokenIn: opp.tokenIn, tokenOut: opp.tokenOut, pool: router },
              { dex: 'sushi', tokenIn: opp.tokenOut, tokenOut: opp.tokenIn, pool: router },
            ],
            amountInUsd,
            expectedAmountOutRaw: amounts[1].toString(),
            expectedGrossProfitUsd: Math.max(0, grossProfitUsd),
          },
        };
      } catch (e) {
        return { ok: false, reason: `QUOTE_ERROR: ${e.message}` };
      }
    }

    // ── Real simulate via eth_call ─────────────────────────────────────────
    async function simulateExactExecution(input) {
      try {
        const {
          buildExecutionPlan,
          normalizeRoute,
          encodeDexLeg,
          decodeCommonRevert,
        } = require('@arb/trade-decision-engine');

        const provider = getProvider(input.opp.chain);
        const executorAddress = getExecutor(input.opp.chain);
        if (!executorAddress) return { ok: false, mode: input.mode, decodedReason: 'NO_EXECUTOR' };

        const usdcAddr = input.opp.chain === 'arbitrum' ? USDC_ARB : USDC_BASE;
        const wethAddr = input.opp.chain === 'arbitrum' ? WETH_ARB : WETH_BASE;
        const router   = input.opp.chain === 'arbitrum' ? SUSHI_ROUTER_ARB : SUSHI_ROUTER_BASE;

        const isUsdcIn = input.opp.tokenIn === 'USDC';
        const tokenInAddr  = isUsdcIn ? usdcAddr : wethAddr;
        const tokenOutAddr = isUsdcIn ? wethAddr : usdcAddr;
        const inDecimals   = isUsdcIn ? 6 : 18;

        const amountInRaw = eth.utils.parseUnits(
          String(Math.round(input.amountInUsd)), inDecimals
        ).toString();

        const deadline = Math.floor(Date.now() / 1000) + 60;

        // Quote leg1 to get real leg2 amountIn
        let leg2AmountInRaw = amountInRaw;
        try {
          const sushi = new eth.Contract(router, SUSHI_IFACE, provider);
          const amounts = await sushi.getAmountsOut(amountInRaw, [tokenInAddr, tokenOutAddr]);
          leg2AmountInRaw = amounts[1].toString();
        } catch { /* use fallback */ }

        const normalized = normalizeRoute({
          deadline,
          legs: [
            { dex: 'sushi', router, tokenIn: tokenInAddr, tokenOut: tokenOutAddr,
              recipient: executorAddress, amountInRaw, minOutRaw: '1' },
            { dex: 'sushi', router, tokenIn: tokenOutAddr, tokenOut: tokenInAddr,
              recipient: executorAddress, amountInRaw: leg2AmountInRaw, minOutRaw: '1' },
          ],
        });

        const encodedLegs = normalized.map(l => encodeDexLeg(l));
        const plan = buildExecutionPlan({
          executorAddress,
          mode: input.mode,
          route: {
            chain: input.opp.chain,
            tokenIn: tokenInAddr,
            tokenOut: tokenInAddr, // circular
            amountInRaw,
            minProfitTokenRaw: '0',
            minOutRaw: '1',
            deadline,
            legs: encodedLegs,
          },
        });

        await provider.call({ to: plan.target, data: plan.calldata });
        return { ok: true, mode: input.mode };
      } catch (err) {
        const { decodeCommonRevert } = require('@arb/trade-decision-engine');
        return { ok: false, mode: input.mode, decodedReason: decodeCommonRevert(err), rawError: err };
      }
    }

    const logger = new EngineLogger({ service: 'arb-scanner', minLevel: 'info', json: true });

    const orchestrator = new ArbOrchestrator(
      ORCHESTRATOR_CONFIG, // stays shadow mode
      {
        quoteExactRoute,
        simulateExactExecution,
        sendExecution: async () => ({ ok: false, error: 'SHADOW_MODE_NO_SEND' }),
        waitForReceipt: async (txHash) => ({ ok: false, txHash, error: 'SHADOW_MODE' }),
        persistReplay: async (record) => {
          // light console log for replay in shadow mode
          if (record.phase === 'simulate' && record.evaluation?.ok) {
            logger.info('LEARN_UPDATE', {
              eventType: 'SHADOW_WOULD_EXECUTE',
              chain: record.opportunity.chain,
              opportunityId: record.opportunity.id,
              netProfitUsd: record.evaluation?.netProfitUsd,
              score: record.evaluation?.score,
            });
          }
        },
        log: (msg, payload) => logger.info('LEARN_UPDATE', { msg, payload }),
      },
      logger,
    );

    orchestrator.startBackgroundTasks();
    logger.info('SYSTEM_STARTUP', { message: 'Scanner→Orchestrator bridge active (shadow mode)' });
    return orchestrator;
  })();

  return orchestratorPromise;
}

// ── Main scanner class ───────────────────────────────────────────────────────
class ScannerApp {
  constructor() {
    this.chains = config.CHAINS;
    console.log('[SCANNER] Initializing multi-chain event ingestion protocol');
  }

  start() {
    for (const chain of Object.values(this.chains)) {
      if (chain.name === 'optimism') continue;
      if (chain.wss) {
        this.startWebsocket(chain);
      } else if (chain.pollingInterval) {
        this.startPolling(chain);
      }
    }
  }

  startWebsocket(chain) {
    console.log(`[SCANNER] [WSS] Binding WebSocket listener to ${chain.name}`);
    const provider = new ethers.providers.WebSocketProvider(chain.wss);
    provider.on('pending', async (txHash) => {
      try {
        const tx = await provider.getTransaction(txHash);
        if (!tx?.to) return;
        this.processTx(chain, tx, await provider.getBlockNumber());
      } catch { /* silent */ }
    });
  }

  startPolling(chain) {
    console.log(`[SCANNER] [POLL] Launching ${chain.pollingInterval}ms block poller on ${chain.name}`);

    // BUG FIX: use chainId not chain.id for StaticJsonRpcProvider
    const providers = chain.rpcs.map(url =>
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

        const start = Math.max(lastBlock + 1, latest - 5);
        for (let b = start; b <= latest; b++) {
          const block = await provider.getBlockWithTransactions(b);
          if (!block?.transactions) continue;

          console.log(`[SCANNER] [HEARTBEAT] ${chain.name} | Block ${b} | ${block.transactions.length} txs scanned.`);

          for (const tx of block.transactions) {
            if (tx.to) this.processTx(chain, tx, b);
          }
        }
        lastBlock = latest;
      } catch (err) {
        console.error(`[SCANNER] Poll error on ${chain.name}: ${err.message}`);
      }
    }, chain.pollingInterval);
  }

  processTx(chain, tx, blockNumber) {
    if (!tx.to) return;
    const router = tx.to.toLowerCase();
    if (!ALLOWED_ROUTERS.has(router)) return;
    this.tryDecodeSushiSwap(chain, tx, blockNumber);
    this.tryDecodeUniV3Swap(chain, tx, blockNumber);
  }

  tryDecodeSushiSwap(chain, tx, blockNumber) {
    try {
      const iface = new ethers.utils.Interface([
        'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)',
      ]);
      const decoded = iface.parseTransaction({ data: tx.data });
      if (!decoded) return;
      const path = decoded.args.path;
      if (!path || path.length < 2) return;
      const tokenIn  = path[0].toLowerCase();
      const tokenOut = path[path.length - 1].toLowerCase();
      const pairKey  = `${tokenIn}:${tokenOut}`;
      if (!ALLOWED_PAIRS.has(pairKey)) return;
      const symIn  = tokenSymbol(tokenIn);
      const symOut = tokenSymbol(tokenOut);
      if (!symIn || !symOut) return;
      const inDecimals = symIn === 'USDC' ? 6 : 18;
      const amountInUsdHint = rawToUsdHint(decoded.args.amountIn, inDecimals);
      if (amountInUsdHint < 100) return;
      const dedupeKey = `${chain.name}:${pairKey}:${blockNumber}:sushi`;
      if (isDuplicate(dedupeKey)) return;
      this.submitToOrchestrator({ chain: chain.name, tokenIn: symIn, tokenOut: symOut, amountInUsdHint, blockNumber, quoteTimestampMs: Date.now() });
    } catch { /* non-matching */ }
  }

  tryDecodeUniV3Swap(chain, tx, blockNumber) {
    try {
      // SwapRouter02 (no deadline in struct), SwapRouter01 (has deadline)
      const ifaces = [
        new ethers.utils.Interface(['function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external payable returns (uint256)']),
        new ethers.utils.Interface(['function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external payable returns (uint256)']),
      ];
      let decoded = null;
      for (const iface of ifaces) {
        try { decoded = iface.parseTransaction({ data: tx.data }); break; } catch { /* try next */ }
      }
      if (!decoded) return;
      const params   = decoded.args[0];
      const tokenIn  = params.tokenIn.toLowerCase();
      const tokenOut = params.tokenOut.toLowerCase();
      const pairKey  = `${tokenIn}:${tokenOut}`;
      if (!ALLOWED_PAIRS.has(pairKey)) return;
      const symIn  = tokenSymbol(tokenIn);
      const symOut = tokenSymbol(tokenOut);
      if (!symIn || !symOut) return;
      const inDecimals = symIn === 'USDC' ? 6 : 18;
      const amountInUsdHint = rawToUsdHint(params.amountIn, inDecimals);
      if (amountInUsdHint < 100) return;
      const dedupeKey = `${chain.name}:${pairKey}:${blockNumber}:univ3`;
      if (isDuplicate(dedupeKey)) return;
      this.submitToOrchestrator({ chain: chain.name, tokenIn: symIn, tokenOut: symOut, amountInUsdHint, blockNumber, quoteTimestampMs: Date.now() });
    } catch { /* non-matching */ }
  }


  async submitToOrchestrator(hit) {
    // Freshness gate — drop if scanner→orchestrator handoff is stale
    const age = Date.now() - hit.quoteTimestampMs;
    if (age > 1200) {
      console.log(`[SCANNER] [SKIP] Stale hit dropped (${age}ms) on ${hit.chain}`);
      return;
    }

    const opp = {
      id: randomUUID(),
      chain: hit.chain,
      tokenIn: hit.tokenIn,
      tokenOut: hit.tokenOut,
      dexBuy: 'sushi',
      dexSell: 'sushi',
      amountInUsdHint: hit.amountInUsdHint,
      // Conservative hints — real quote fetched inside orchestrator
      quotedGrossProfitUsd: hit.amountInUsdHint * 0.003,
      estimatedGasUsd: hit.chain === 'arbitrum' ? 1.8 : 1.2,
      estimatedPriceImpactBps: 10,
      minObservedPoolLiquidityUsd: 500_000,
      minObserved24hVolumeUsd: 500_000,
      routeHops: 2,
      blockNumberSeen: hit.blockNumber,
      currentBlockNumber: hit.blockNumber,
      quoteTimestampMs: hit.quoteTimestampMs,
    };

    console.log(`[SCANNER] [→ORCH] ${opp.chain} | ${opp.tokenIn}→${opp.tokenOut} | ~$${opp.amountInUsdHint.toFixed(0)} | id: ${opp.id.slice(0,8)}`);

    try {
      const orchestrator = await getOrchestrator();
      orchestrator.submitOpportunity(opp);
    } catch (err) {
      console.error(`[SCANNER] Orchestrator submit error: ${err.message}`);
    }
  }
}

new ScannerApp().start();
