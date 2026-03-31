const { ethers } = require("ethers");
const { getChain } = require("../config");

// ---------- ABIs ----------
const V2_ROUTER_ABI = [
  "function getAmountsOut(uint256 amountIn, address[] memory path) external view returns (uint256[] memory amounts)",
];

const V2_FACTORY_ABI = [
  "function getPair(address tokenA, address tokenB) external view returns (address pair)",
];

const V2_PAIR_ABI = [
  "function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  "function token0() external view returns (address)",
  "function token1() external view returns (address)",
];

const V3_QUOTER_V2_ABI = [
  "function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)",
];

const V3_FACTORY_ABI = [
  "function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)",
];

const V3_POOL_ABI = [
  "function liquidity() external view returns (uint128)",
];

// ---------- Constants ----------
const DEFAULT_UNIV3_QUOTER_V2 =
  process.env.POLYGON_UNIV3_QUOTER_V2 ||
  "0x61fFE014bA17989E743c5F6cB21bF9697530B21e";

const DEFAULT_UNIV3_FACTORY =
  process.env.POLYGON_UNIV3_FACTORY ||
  "0x1F98431c8aD98523631AE4a59f267346ea31F984";

const DEFAULT_V2_FACTORIES = {
  sushi:
    process.env.POLYGON_SUSHI_FACTORY ||
    "0xc35DADB65012eC5796536bD9864eD8773aBc74C4",
  quickswap:
    process.env.POLYGON_QUICKSWAP_FACTORY ||
    "0x5757371414417b8c6caad45baef941abc7d3ab32",
};

// ---------- Helpers ----------
function bn(v) {
  return ethers.BigNumber.from(String(v));
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function getDeadline() {
  return nowSec() + Number(process.env.ROUTE_DEADLINE_SECONDS || 45);
}

function slippageBps() {
  return Number(process.env.SLIPPAGE_BPS || 50);
}

function flashPremiumBps() {
  return Number(process.env.FLASH_LOAN_PREMIUM_BPS || 5);
}

function gasUnitsApprox() {
  return Number(process.env.GAS_UNITS_APPROX || 260000);
}

function timeoutBudgetMs() {
  return Number(process.env.QUOTE_TIMEOUT_BUDGET_MS || 3500);
}

function minV2ReserveUsd() {
  return Number(process.env.MIN_V2_POOL_RESERVE_USD || 2500);
}

function minV3LiquidityRaw() {
  return bn(process.env.MIN_V3_POOL_LIQUIDITY_RAW || "1000");
}

function getProbeFeeTiers() {
  return (process.env.UNIV3_FEE_TIERS || "100,500,3000")
    .split(",")
    .map((v) => Number(v.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
}

function getProbeUsdSizes(defaultUsd) {
  const raw =
    process.env.DRY_RUN_USD_SIZES ||
    `${defaultUsd || process.env.DRY_RUN_USD || process.env.TRADE_USD_HINT || "5"},10,25`;

  return raw
    .split(",")
    .map((v) => Number(v.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
}

function applySlippage(rawAmount) {
  return bn(rawAmount).mul(10000 - slippageBps()).div(10000);
}

function parseAmountUsdToRaw(symbol, usdAmount, nativeTokenUsd) {
  const s = String(symbol).toUpperCase();

  if (s === "USDC" || s === "USDC_BRIDGED" || s === "USDT") {
    return ethers.utils.parseUnits(String(usdAmount), 6);
  }

  if (s === "WETH") {
    const ethUsd = Number(
      nativeTokenUsd || process.env.ETH_PRICE_USD_HINT || 2200
    );
    return ethers.utils.parseUnits(String(usdAmount / ethUsd), 18);
  }

  if (s === "WMATIC") {
    const maticUsd = Number(process.env.MATIC_PRICE_USD_HINT || 1.0);
    return ethers.utils.parseUnits(String(usdAmount / maticUsd), 18);
  }

  return ethers.utils.parseUnits(String(usdAmount), 18);
}

function rawToUsd(symbol, raw, nativeTokenUsd) {
  const s = String(symbol).toUpperCase();
  if (!raw) return 0;

  if (s === "USDC" || s === "USDC_BRIDGED" || s === "USDT") {
    return Number(ethers.utils.formatUnits(raw, 6));
  }

  if (s === "WETH") {
    const ethUsd = Number(
      nativeTokenUsd || process.env.ETH_PRICE_USD_HINT || 2200
    );
    return Number(ethers.utils.formatUnits(raw, 18)) * ethUsd;
  }

  if (s === "WMATIC") {
    const maticUsd = Number(process.env.MATIC_PRICE_USD_HINT || 1.0);
    return Number(ethers.utils.formatUnits(raw, 18)) * maticUsd;
  }

  return Number(ethers.utils.formatUnits(raw, 18));
}

function usdToMinProfitRaw(symbol, usd, nativeTokenUsd) {
  const s = String(symbol).toUpperCase();

  if (s === "USDC" || s === "USDC_BRIDGED" || s === "USDT") {
    return ethers.utils.parseUnits(String(usd), 6);
  }

  if (s === "WETH") {
    const ethUsd = Number(
      nativeTokenUsd || process.env.ETH_PRICE_USD_HINT || 2200
    );
    return ethers.utils.parseUnits(String(usd / ethUsd), 18);
  }

  if (s === "WMATIC") {
    const maticUsd = Number(process.env.MATIC_PRICE_USD_HINT || 1.0);
    return ethers.utils.parseUnits(String(usd / maticUsd), 18);
  }

  return ethers.utils.parseUnits(String(usd), 18);
}

async function getGasUsd(provider, nativeTokenUsd) {
  const gasPrice = await provider.getGasPrice();
  const gasNative = Number(
    ethers.utils.formatEther(gasPrice.mul(gasUnitsApprox()))
  );
  return gasNative * Number(nativeTokenUsd || process.env.ETH_PRICE_USD_HINT || 2200);
}

function routeId(parts) {
  return parts.join("|");
}

function buildLeg({ dex, tokenIn, tokenOut, amountInRaw, quotedOutRaw }) {
  return {
    kind: dex.kind,
    dex: dex.baseName || dex.name,
    router: dex.router,
    tokenIn,
    tokenOut,
    amountInRaw: String(amountInRaw),
    minOutRaw: applySlippage(quotedOutRaw).toString(),
    fee: dex.kind === "v3" ? Number(dex.fee) : 0,
  };
}

function withinBudget(startedAt) {
  return Date.now() - startedAt < timeoutBudgetMs();
}

// ---------- DEX catalog ----------
function buildDexCatalog(chain) {
  const dexes = chain.dexes || {};
  const out = [];

  if (dexes.sushi?.router) {
    out.push({
      name: "sushi",
      kind: "v2",
      router: dexes.sushi.router,
      factory: DEFAULT_V2_FACTORIES.sushi,
    });
  }

  if (dexes.quickswap?.router) {
    out.push({
      name: "quickswap",
      kind: "v2",
      router: dexes.quickswap.router,
      factory: DEFAULT_V2_FACTORIES.quickswap,
    });
  }

  if (dexes.univ3?.router) {
    for (const fee of getProbeFeeTiers()) {
      out.push({
        name: `univ3-${fee}`,
        baseName: "univ3",
        kind: "v3",
        router: dexes.univ3.router,
        quoter: DEFAULT_UNIV3_QUOTER_V2,
        factory: DEFAULT_UNIV3_FACTORY,
        fee,
      });
    }
  }

  return out;
}

function buildTokenPairs(chain) {
  const t = chain.tokens || {};
  const pairs = [];

  if (t.USDC?.address && t.WETH?.address) {
    pairs.push({
      tokenInSymbol: "USDC",
      tokenIn: t.USDC.address,
      tokenOutSymbol: "WETH",
      tokenOut: t.WETH.address,
    });
  }

  if (t.USDC?.address && t.WMATIC?.address) {
    pairs.push({
      tokenInSymbol: "USDC",
      tokenIn: t.USDC.address,
      tokenOutSymbol: "WMATIC",
      tokenOut: t.WMATIC.address,
    });
  }

  if (t.WETH?.address && t.WMATIC?.address) {
    pairs.push({
      tokenInSymbol: "WETH",
      tokenIn: t.WETH.address,
      tokenOutSymbol: "WMATIC",
      tokenOut: t.WMATIC.address,
    });
  }

  return pairs;
}

// ---------- Pool checks / pruning ----------
async function v2PairInfo(provider, factoryAddress, tokenA, tokenB) {
  const factory = new ethers.Contract(factoryAddress, V2_FACTORY_ABI, provider);
  const pairAddress = await factory.getPair(tokenA, tokenB);

  if (!pairAddress || pairAddress === ethers.constants.AddressZero) {
    return null;
  }

  const pair = new ethers.Contract(pairAddress, V2_PAIR_ABI, provider);
  const [reserves, token0, token1] = await Promise.all([
    pair.getReserves(),
    pair.token0(),
    pair.token1(),
  ]);

  return {
    pairAddress,
    token0,
    token1,
    reserve0: bn(reserves.reserve0),
    reserve1: bn(reserves.reserve1),
  };
}

function v2ReserveUsdEstimate(pairInfo, tokenA, tokenB, nativeTokenUsd) {
  const t0 = pairInfo.token0.toLowerCase();
  const ta = tokenA.address.toLowerCase();
  const tb = tokenB.address.toLowerCase();

  const reserveA = t0 === ta ? pairInfo.reserve0 : pairInfo.reserve1;
  const reserveB = t0 === tb ? pairInfo.reserve0 : pairInfo.reserve1;

  return (
    rawToUsd(tokenA.symbol, reserveA, nativeTokenUsd) +
    rawToUsd(tokenB.symbol, reserveB, nativeTokenUsd)
  );
}

async function hasHealthyV2Pool(
  provider,
  dex,
  tokenA,
  tokenB,
  nativeTokenUsd,
  cache
) {
  const key = `v2:${dex.factory}:${tokenA.address}:${tokenB.address}`;
  if (cache.has(key)) return cache.get(key);

  try {
    const pairInfo = await v2PairInfo(
      provider,
      dex.factory,
      tokenA.address,
      tokenB.address
    );
    if (!pairInfo) {
      cache.set(key, null);
      return null;
    }

    const reserveUsd = v2ReserveUsdEstimate(pairInfo, tokenA, tokenB, nativeTokenUsd);
    if (reserveUsd < minV2ReserveUsd()) {
      cache.set(key, null);
      return null;
    }

    const out = { pairInfo, reserveUsd };
    cache.set(key, out);
    return out;
  } catch {
    cache.set(key, null);
    return null;
  }
}

async function hasHealthyV3Pool(provider, dex, tokenA, tokenB, cache) {
  const key = `v3:${dex.factory}:${tokenA.address}:${tokenB.address}:${dex.fee}`;
  if (cache.has(key)) return cache.get(key);

  try {
    const factory = new ethers.Contract(dex.factory, V3_FACTORY_ABI, provider);
    const poolAddress = await factory.getPool(
      tokenA.address,
      tokenB.address,
      dex.fee
    );

    if (!poolAddress || poolAddress === ethers.constants.AddressZero) {
      cache.set(key, null);
      return null;
    }

    const pool = new ethers.Contract(poolAddress, V3_POOL_ABI, provider);
    const liquidity = bn(await pool.liquidity());

    if (liquidity.lt(minV3LiquidityRaw())) {
      cache.set(key, null);
      return null;
    }

    const out = { poolAddress, liquidity: liquidity.toString() };
    cache.set(key, out);
    return out;
  } catch {
    cache.set(key, null);
    return null;
  }
}

// ---------- Quote helpers ----------
async function quoteV2(provider, dex, amountInRaw, tokenIn, tokenOut) {
  const router = new ethers.Contract(dex.router, V2_ROUTER_ABI, provider);
  const amounts = await router.getAmountsOut(amountInRaw, [tokenIn, tokenOut]);
  if (!Array.isArray(amounts) || amounts.length < 2) {
    throw new Error("BAD_V2_QUOTE");
  }
  return bn(amounts[amounts.length - 1]);
}

async function quoteV3(provider, dex, amountInRaw, tokenIn, tokenOut) {
  const quoter = new ethers.Contract(dex.quoter, V3_QUOTER_V2_ABI, provider);
  const result = await quoter.callStatic.quoteExactInputSingle({
    tokenIn,
    tokenOut,
    amountIn: amountInRaw,
    fee: dex.fee,
    sqrtPriceLimitX96: 0,
  });

  return bn(result.amountOut || result[0]);
}

async function quoteDex(provider, dex, amountInRaw, tokenIn, tokenOut) {
  if (dex.kind === "v2") {
    return quoteV2(provider, dex, amountInRaw, tokenIn, tokenOut);
  }
  if (dex.kind === "v3") {
    return quoteV3(provider, dex, amountInRaw, tokenIn, tokenOut);
  }
  throw new Error(`UNSUPPORTED_DEX_KIND:${dex.kind}`);
}

// ---------- Main ----------
async function getOptimalQuote({
  chainKey,
  provider,
  amountInUsd,
  nativeTokenUsd,
}) {
  const startedAt = Date.now();
  const chain = getChain(chainKey);
  const dexes = buildDexCatalog(chain);
  const pairs = buildTokenPairs(chain);
  const poolCache = new Map();

  if (!dexes.length) {
    return { ok: false, reason: "NO_DEXES", bestRoute: null, routes: [] };
  }
  if (!pairs.length) {
    return { ok: false, reason: "NO_PAIRS", bestRoute: null, routes: [] };
  }

  let gasUsd;
  try {
    gasUsd = await getGasUsd(provider, nativeTokenUsd);
  } catch {
    gasUsd = Number(process.env.GAS_USD_FALLBACK || 0.03);
  }

  const routes = [];
  const seen = new Set();
  const usdSizes = getProbeUsdSizes(amountInUsd);

  for (const pair of pairs) {
    if (!withinBudget(startedAt)) {
      return {
        ok: false,
        reason: "QUOTE_TIMEOUT",
        bestRoute: null,
        routes: [],
      };
    }

    const tokenInRef = { symbol: pair.tokenInSymbol, address: pair.tokenIn };
    const tokenOutRef = { symbol: pair.tokenOutSymbol, address: pair.tokenOut };

    for (const usdSize of usdSizes) {
      const amountInRaw = parseAmountUsdToRaw(
        pair.tokenInSymbol,
        usdSize,
        nativeTokenUsd
      );

      for (const buyDex of dexes) {
        if (!withinBudget(startedAt)) break;

        let buyPoolOk = null;
        if (buyDex.kind === "v2") {
          buyPoolOk = await hasHealthyV2Pool(
            provider,
            buyDex,
            tokenInRef,
            tokenOutRef,
            nativeTokenUsd,
            poolCache
          );
        } else {
          buyPoolOk = await hasHealthyV3Pool(
            provider,
            buyDex,
            tokenInRef,
            tokenOutRef,
            poolCache
          );
        }
        if (!buyPoolOk) continue;

        let leg1Out;
        try {
          leg1Out = await quoteDex(
            provider,
            buyDex,
            amountInRaw,
            pair.tokenIn,
            pair.tokenOut
          );
        } catch {
          continue;
        }

        if (!leg1Out || leg1Out.lte(0)) continue;

        for (const sellDex of dexes) {
          if (!withinBudget(startedAt)) break;
          if (buyDex.name === sellDex.name) continue;

          let sellPoolOk = null;
          if (sellDex.kind === "v2") {
            sellPoolOk = await hasHealthyV2Pool(
              provider,
              sellDex,
              tokenOutRef,
              tokenInRef,
              nativeTokenUsd,
              poolCache
            );
          } else {
            sellPoolOk = await hasHealthyV3Pool(
              provider,
              sellDex,
              tokenOutRef,
              tokenInRef,
              poolCache
            );
          }
          if (!sellPoolOk) continue;

          let leg2Out;
          try {
            leg2Out = await quoteDex(
              provider,
              sellDex,
              leg1Out,
              pair.tokenOut,
              pair.tokenIn
            );
          } catch {
            continue;
          }

          if (!leg2Out || leg2Out.lte(0)) continue;

          const grossProfitTokenRaw = leg2Out.sub(amountInRaw);
          const grossProfitUsd = rawToUsd(
            pair.tokenInSymbol,
            grossProfitTokenRaw,
            nativeTokenUsd
          );

          const flashFeeRaw = amountInRaw.mul(flashPremiumBps()).div(10000);
          const flashFeeUsd = rawToUsd(
            pair.tokenInSymbol,
            flashFeeRaw,
            nativeTokenUsd
          );

          const netProfitUsd = grossProfitUsd - gasUsd - flashFeeUsd;

          const route = {
            id: routeId([
              chain.name,
              pair.tokenInSymbol,
              pair.tokenOutSymbol,
              buyDex.name,
              sellDex.name,
              String(usdSize),
            ]),
            chain: chain.name,
            tokenIn: pair.tokenIn,
            tokenOut: pair.tokenOut,
            tokenInSymbol: pair.tokenInSymbol,
            tokenOutSymbol: pair.tokenOutSymbol,
            amountInRaw: amountInRaw.toString(),
            expectedAmountOutRaw: leg2Out.toString(),
            grossProfitTokenRaw: grossProfitTokenRaw.toString(),
            minProfitTokenRaw: usdToMinProfitRaw(
              pair.tokenInSymbol,
              Math.max(
                Number(process.env.MIN_NET_PROFIT_USD || process.env.MIN_PROFIT_USD || 0.01),
                0.000001
              ),
              nativeTokenUsd
            ).toString(),
            grossProfitUsd,
            gasUsd,
            flashFeeUsd,
            netProfitUsd,
            deadline: getDeadline(),
            legs: [
              buildLeg({
                dex: buyDex,
                tokenIn: pair.tokenIn,
                tokenOut: pair.tokenOut,
                amountInRaw,
                quotedOutRaw: leg1Out,
              }),
              buildLeg({
                dex: sellDex,
                tokenIn: pair.tokenOut,
                tokenOut: pair.tokenIn,
                amountInRaw: leg1Out,
                quotedOutRaw: leg2Out,
              }),
            ],
            metadata: {
              buyDex: buyDex.name,
              sellDex: sellDex.name,
              amountInUsd: usdSize,
            },
          };

          if (!seen.has(route.id)) {
            seen.add(route.id);
            routes.push(route);
          }
        }
      }
    }
  }

  const positive = routes
    .filter((r) => Number.isFinite(r.netProfitUsd))
    .sort((a, b) => Number(b.netProfitUsd) - Number(a.netProfitUsd));

  const bestRoute = positive[0] || null;

  return {
    ok: !!bestRoute,
    reason: bestRoute ? null : "NO_ROUTE",
    bestRoute,
    routes: positive.slice(0, 25),
  };
}

// Compatibility shim for older imports
class QuoteEngine {
  constructor(providers = {}) {
    this.providers = providers;
  }

  async getOptimalQuote(tokenIn, tokenOut, amountIn, dexAdapters) {
    if (!Array.isArray(dexAdapters) || !dexAdapters.length) {
      return {
        bestQuote: null,
        bestDex: null,
        targets: [],
        executePayloads: [],
        roundTripQuote: null,
        routePlan: null,
      };
    }

    const opportunities = [];

    for (const buyAdapter of dexAdapters) {
      let leg1Out;
      try {
        leg1Out = await buyAdapter.getAmountOut(amountIn, [tokenIn, tokenOut]);
      } catch {
        continue;
      }
      if (!leg1Out) continue;

      for (const sellAdapter of dexAdapters) {
        if (buyAdapter.name === sellAdapter.name) continue;

        let leg2Out;
        try {
          leg2Out = await sellAdapter.getAmountOut(leg1Out, [tokenOut, tokenIn]);
        } catch {
          continue;
        }
        if (!leg2Out) continue;

        const profitRaw = bn(leg2Out).sub(bn(amountIn));
        opportunities.push({
          buyDex: buyAdapter.name,
          sellDex: sellAdapter.name,
          leg1OutRaw: String(leg1Out),
          leg2OutRaw: String(leg2Out),
          profitRaw,
        });
      }
    }

    if (!opportunities.length) {
      return {
        bestQuote: null,
        bestDex: null,
        targets: [],
        executePayloads: [],
        roundTripQuote: null,
        routePlan: null,
      };
    }

    opportunities.sort((a, b) => (a.profitRaw.gt(b.profitRaw) ? -1 : 1));
    const best = opportunities[0];

    return {
      bestQuote: best.leg1OutRaw,
      bestDex: `${best.buyDex}->${best.sellDex}`,
      targets: [],
      executePayloads: [],
      roundTripQuote: best.leg2OutRaw,
      routePlan: {
        buyDex: best.buyDex,
        sellDex: best.sellDex,
        expectedAmountOutRaw: best.leg2OutRaw,
        leg1OutRaw: best.leg1OutRaw,
        leg2OutRaw: best.leg2OutRaw,
        leg1MinOutRaw: applySlippage(best.leg1OutRaw).toString(),
        leg2MinOutRaw: applySlippage(best.leg2OutRaw).toString(),
        grossProfitTokenRaw: best.profitRaw.toString(),
      },
    };
  }
}

module.exports = {
  getOptimalQuote,
  QuoteEngine,
  default: QuoteEngine,
};
