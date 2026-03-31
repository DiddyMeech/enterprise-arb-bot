const { ethers } = require("ethers");
const { getChain } = require("../config");
const {
  aggregate3,
  encodeCall,
  decodeCallResult,
  promiseWithTimeout,
} = require("./multicall");

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

const V3_FACTORY_ABI = [
  "function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)",
];

const V3_POOL_ABI = [
  "function liquidity() external view returns (uint128)",
];

const V3_QUOTER_V2_ABI = [
  "function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)",
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
  return Number(process.env.SLIPPAGE_BPS || 60);
}

function flashPremiumBps() {
  return Number(process.env.FLASH_LOAN_PREMIUM_BPS || 5);
}

function gasUnitsApprox(legCount = 2) {
  const base = Number(process.env.GAS_UNITS_APPROX || 260000);
  const extraPerLeg = Number(process.env.GAS_UNITS_PER_EXTRA_LEG || 90000);
  return legCount <= 2 ? base : base + (legCount - 2) * extraPerLeg;
}

function timeoutBudgetMs() {
  return Number(process.env.QUOTE_TIMEOUT_BUDGET_MS || 5000);
}

function rpcCallTimeoutMs() {
  return Number(process.env.RPC_CALL_TIMEOUT_MS || 2500);
}

function quoteBatchSize() {
  return Number(process.env.QUOTE_BATCH_SIZE || 80);
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

async function getGasUsd(provider, nativeTokenUsd, legCount = 2) {
  const gasPrice = await promiseWithTimeout(
    provider.getGasPrice(),
    rpcCallTimeoutMs(),
    "GAS_PRICE_TIMEOUT"
  );
  const gasNative = Number(
    ethers.utils.formatEther(gasPrice.mul(gasUnitsApprox(legCount)))
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

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
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

// ---------- Token universe ----------
function buildTokenUniverse(chain) {
  const t = chain.tokens || {};
  const universe = [];

  if (t.USDC?.address) universe.push({ symbol: "USDC", address: t.USDC.address });
  if (t.WETH?.address) universe.push({ symbol: "WETH", address: t.WETH.address });
  if (t.WMATIC?.address) universe.push({ symbol: "WMATIC", address: t.WMATIC.address });

  return universe;
}

function buildTwoLegPairs(universe) {
  const out = [];
  const by = Object.fromEntries(universe.map((t) => [t.symbol, t]));

  if (by.USDC && by.WETH) {
    out.push({
      tokenInSymbol: "USDC",
      tokenIn: by.USDC.address,
      tokenOutSymbol: "WETH",
      tokenOut: by.WETH.address,
      shape: "2LEG",
    });
  }

  if (by.USDC && by.WMATIC) {
    out.push({
      tokenInSymbol: "USDC",
      tokenIn: by.USDC.address,
      tokenOutSymbol: "WMATIC",
      tokenOut: by.WMATIC.address,
      shape: "2LEG",
    });
  }

  if (by.WETH && by.WMATIC) {
    out.push({
      tokenInSymbol: "WETH",
      tokenIn: by.WETH.address,
      tokenOutSymbol: "WMATIC",
      tokenOut: by.WMATIC.address,
      shape: "2LEG",
    });
  }

  return out;
}

function buildTriangularCycles(universe) {
  const out = [];

  for (const start of universe) {
    for (const mid1 of universe) {
      if (mid1.address === start.address) continue;

      for (const mid2 of universe) {
        if (mid2.address === start.address) continue;
        if (mid2.address === mid1.address) continue;

        out.push({
          shape: "3LEG",
          startSymbol: start.symbol,
          start: start.address,
          mid1Symbol: mid1.symbol,
          mid1: mid1.address,
          mid2Symbol: mid2.symbol,
          mid2: mid2.address,
        });
      }
    }
  }

  return out.filter(
    (c) =>
      c.startSymbol === "USDC" ||
      c.mid1Symbol === "WMATIC" ||
      c.mid2Symbol === "WMATIC"
  );
}

// ---------- Multicall builders ----------
function makePairKey(dexName, a, b, extra = "") {
  return `${dexName}|${a.toLowerCase()}|${b.toLowerCase()}|${extra}`;
}

async function batchDiscoverPools(provider, dexes, universe) {
  const calls = [];
  const meta = [];

  for (const dex of dexes) {
    for (const a of universe) {
      for (const b of universe) {
        if (a.address.toLowerCase() === b.address.toLowerCase()) continue;
        if (a.address.toLowerCase() > b.address.toLowerCase()) continue;

        if (dex.kind === "v2") {
          const { iface, callData } = encodeCall(V2_FACTORY_ABI, "getPair", [
            a.address,
            b.address,
          ]);
          calls.push({
            target: dex.factory,
            allowFailure: true,
            callData,
          });
          meta.push({ type: "v2-pair", dex, a, b, iface });
        } else {
          const { iface, callData } = encodeCall(V3_FACTORY_ABI, "getPool", [
            a.address,
            b.address,
            dex.fee,
          ]);
          calls.push({
            target: dex.factory,
            allowFailure: true,
            callData,
          });
          meta.push({ type: "v3-pool", dex, a, b, iface });
        }
      }
    }
  }

  const discovered = new Map();

  for (const batch of chunk(calls.map((c, i) => ({ call: c, meta: meta[i] })), quoteBatchSize())) {
    const results = await aggregate3(
      provider,
      batch.map((x) => x.call),
      rpcCallTimeoutMs()
    );

    batch.forEach((item, idx) => {
      const res = results[idx];
      if (!res.success) return;

      try {
        const decoded =
          item.meta.type === "v2-pair"
            ? decodeCallResult(item.meta.iface, "getPair", res.returnData)
            : decodeCallResult(item.meta.iface, "getPool", res.returnData);

        const addr = decoded[0];
        if (!addr || addr === ethers.constants.AddressZero) return;

        const key = makePairKey(
          item.meta.dex.name,
          item.meta.a.address,
          item.meta.b.address,
          item.meta.dex.kind === "v3" ? item.meta.dex.fee : ""
        );

        discovered.set(key, {
          dex: item.meta.dex,
          a: item.meta.a,
          b: item.meta.b,
          address: addr,
        });
      } catch {}
    });
  }

  return discovered;
}

async function batchFetchPoolHealth(provider, discovered, nativeTokenUsd) {
  const reserveCalls = [];
  const reserveMeta = [];

  for (const [, info] of discovered.entries()) {
    if (info.dex.kind === "v2") {
      const c1 = encodeCall(V2_PAIR_ABI, "getReserves", []);
      reserveCalls.push({
        target: info.address,
        allowFailure: true,
        callData: c1.callData,
      });
      reserveMeta.push({ type: "reserves", info, iface: c1.iface });

      const c2 = encodeCall(V2_PAIR_ABI, "token0", []);
      reserveCalls.push({
        target: info.address,
        allowFailure: true,
        callData: c2.callData,
      });
      reserveMeta.push({ type: "token0", info, iface: c2.iface });

      const c3 = encodeCall(V2_PAIR_ABI, "token1", []);
      reserveCalls.push({
        target: info.address,
        allowFailure: true,
        callData: c3.callData,
      });
      reserveMeta.push({ type: "token1", info, iface: c3.iface });
    } else {
      const c = encodeCall(V3_POOL_ABI, "liquidity", []);
      reserveCalls.push({
        target: info.address,
        allowFailure: true,
        callData: c.callData,
      });
      reserveMeta.push({ type: "liquidity", info, iface: c.iface });
    }
  }

  const hydrated = new Map();
  const temp = new Map();

  for (const batch of chunk(reserveCalls.map((c, i) => ({ call: c, meta: reserveMeta[i] })), quoteBatchSize())) {
    const results = await aggregate3(
      provider,
      batch.map((x) => x.call),
      rpcCallTimeoutMs()
    );

    batch.forEach((item, idx) => {
      const res = results[idx];
      const baseKey = makePairKey(
        item.meta.info.dex.name,
        item.meta.info.a.address,
        item.meta.info.b.address,
        item.meta.info.dex.kind === "v3" ? item.meta.info.dex.fee : ""
      );

      if (!temp.has(baseKey)) temp.set(baseKey, { ...item.meta.info });

      if (!res.success) return;

      try {
        if (item.meta.type === "reserves") {
          const decoded = decodeCallResult(item.meta.iface, "getReserves", res.returnData);
          temp.get(baseKey).reserve0 = bn(decoded[0]);
          temp.get(baseKey).reserve1 = bn(decoded[1]);
        } else if (item.meta.type === "token0") {
          const decoded = decodeCallResult(item.meta.iface, "token0", res.returnData);
          temp.get(baseKey).token0 = decoded[0];
        } else if (item.meta.type === "token1") {
          const decoded = decodeCallResult(item.meta.iface, "token1", res.returnData);
          temp.get(baseKey).token1 = decoded[0];
        } else if (item.meta.type === "liquidity") {
          const decoded = decodeCallResult(item.meta.iface, "liquidity", res.returnData);
          temp.get(baseKey).liquidity = bn(decoded[0]);
        }
      } catch {}
    });
  }

  for (const [key, info] of temp.entries()) {
    if (info.dex.kind === "v2") {
      if (!info.reserve0 || !info.reserve1 || !info.token0 || !info.token1) continue;

      const t0 = info.token0.toLowerCase();
      const reserveA = t0 === info.a.address.toLowerCase() ? info.reserve0 : info.reserve1;
      const reserveB = t0 === info.b.address.toLowerCase() ? info.reserve0 : info.reserve1;

      const reserveUsd =
        rawToUsd(info.a.symbol, reserveA, nativeTokenUsd) +
        rawToUsd(info.b.symbol, reserveB, nativeTokenUsd);

      if (reserveUsd < minV2ReserveUsd()) continue;

      hydrated.set(key, {
        ...info,
        reserveUsd,
      });
    } else {
      if (!info.liquidity || info.liquidity.lt(minV3LiquidityRaw())) continue;
      hydrated.set(key, info);
    }
  }

  return hydrated;
}

async function batchQuoteEdges(provider, healthyPools, usdSizes, nativeTokenUsd) {
  const calls = [];
  const meta = [];

  for (const [, info] of healthyPools.entries()) {
    for (const size of usdSizes) {
      const amountInRawA = parseAmountUsdToRaw(info.a.symbol, size, nativeTokenUsd);
      const amountInRawB = parseAmountUsdToRaw(info.b.symbol, size, nativeTokenUsd);

      if (info.dex.kind === "v2") {
        const c1 = encodeCall(V2_ROUTER_ABI, "getAmountsOut", [
          amountInRawA,
          [info.a.address, info.b.address],
        ]);
        calls.push({
          target: info.dex.router,
          allowFailure: true,
          callData: c1.callData,
        });
        meta.push({
          dex: info.dex,
          from: info.a,
          to: info.b,
          amountInRaw: amountInRawA,
          size,
          iface: c1.iface,
          fn: "getAmountsOut",
        });

        const c2 = encodeCall(V2_ROUTER_ABI, "getAmountsOut", [
          amountInRawB,
          [info.b.address, info.a.address],
        ]);
        calls.push({
          target: info.dex.router,
          allowFailure: true,
          callData: c2.callData,
        });
        meta.push({
          dex: info.dex,
          from: info.b,
          to: info.a,
          amountInRaw: amountInRawB,
          size,
          iface: c2.iface,
          fn: "getAmountsOut",
        });
      } else {
        const c1 = encodeCall(V3_QUOTER_V2_ABI, "quoteExactInputSingle", [
          {
            tokenIn: info.a.address,
            tokenOut: info.b.address,
            amountIn: amountInRawA,
            fee: info.dex.fee,
            sqrtPriceLimitX96: 0,
          },
        ]);
        calls.push({
          target: info.dex.quoter,
          allowFailure: true,
          callData: c1.callData,
        });
        meta.push({
          dex: info.dex,
          from: info.a,
          to: info.b,
          amountInRaw: amountInRawA,
          size,
          iface: c1.iface,
          fn: "quoteExactInputSingle",
        });

        const c2 = encodeCall(V3_QUOTER_V2_ABI, "quoteExactInputSingle", [
          {
            tokenIn: info.b.address,
            tokenOut: info.a.address,
            amountIn: amountInRawB,
            fee: info.dex.fee,
            sqrtPriceLimitX96: 0,
          },
        ]);
        calls.push({
          target: info.dex.quoter,
          allowFailure: true,
          callData: c2.callData,
        });
        meta.push({
          dex: info.dex,
          from: info.b,
          to: info.a,
          amountInRaw: amountInRawB,
          size,
          iface: c2.iface,
          fn: "quoteExactInputSingle",
        });
      }
    }
  }

  const quotes = new Map();

  for (const batch of chunk(calls.map((c, i) => ({ call: c, meta: meta[i] })), quoteBatchSize())) {
    const results = await aggregate3(
      provider,
      batch.map((x) => x.call),
      rpcCallTimeoutMs()
    );

    batch.forEach((item, idx) => {
      const res = results[idx];
      if (!res.success) return;

      try {
        const decoded = decodeCallResult(item.meta.iface, item.meta.fn, res.returnData);
        const amountOut =
          item.meta.fn === "getAmountsOut"
            ? bn(decoded[0][decoded[0].length - 1])
            : bn(decoded[0]?.amountOut || decoded[0]);

        if (!amountOut || amountOut.lte(0)) return;

        const key = [
          item.meta.dex.name,
          item.meta.from.address.toLowerCase(),
          item.meta.to.address.toLowerCase(),
          item.meta.size,
        ].join("|");

        quotes.set(key, {
          dex: item.meta.dex,
          from: item.meta.from,
          to: item.meta.to,
          size: item.meta.size,
          amountInRaw: item.meta.amountInRaw,
          amountOutRaw: amountOut,
        });
      } catch {}
    });
  }

  return quotes;
}

// ---------- Route assembly ----------
function getQuote(quotes, dexName, from, to, size) {
  return quotes.get([dexName, from.toLowerCase(), to.toLowerCase(), size].join("|")) || null;
}

async function getOptimalQuote({
  chainKey,
  provider,
  amountInUsd,
  nativeTokenUsd,
}) {
  const startedAt = Date.now();
  const chain = getChain(chainKey);
  const dexes = buildDexCatalog(chain);
  const universe = buildTokenUniverse(chain);
  const twoLegPairs = buildTwoLegPairs(universe);
  const cycles = buildTriangularCycles(universe);
  const usdSizes = [
    Number(amountInUsd || process.env.DRY_RUN_USD || process.env.TRADE_USD_HINT || 5)
  ].filter((n) => Number.isFinite(n) && n > 0);

  let baseGasUsd2 = Number(process.env.GAS_USD_FALLBACK || 0.05);
  try {
    baseGasUsd2 = await getGasUsd(provider, nativeTokenUsd, 2);
  } catch {}
  let globalGasUsd3 = null;

  if (!dexes.length) return { ok: false, reason: "NO_DEXES", bestRoute: null, routes: [] };
  if (!universe.length) return { ok: false, reason: "NO_TOKENS", bestRoute: null, routes: [] };

  if (!withinBudget(startedAt)) {
    return { ok: false, reason: "QUOTE_TIMEOUT", bestRoute: null, routes: [] };
  }

  const discovered = await batchDiscoverPools(provider, dexes, universe);
  if (!withinBudget(startedAt)) {
    return { ok: false, reason: "QUOTE_TIMEOUT", bestRoute: null, routes: [] };
  }

  const healthyPools = await batchFetchPoolHealth(provider, discovered, nativeTokenUsd);
  if (!withinBudget(startedAt)) {
    return { ok: false, reason: "QUOTE_TIMEOUT", bestRoute: null, routes: [] };
  }

  const quotes = await batchQuoteEdges(provider, healthyPools, usdSizes, nativeTokenUsd);
  if (!withinBudget(startedAt)) {
    return { ok: false, reason: "QUOTE_TIMEOUT", bestRoute: null, routes: [] };
  }

  const routes = [];
  const seen = new Set();

  for (const size of usdSizes) {
    for (const pair of twoLegPairs) {
      for (const buyDex of dexes) {
        const q1 = getQuote(quotes, buyDex.name, pair.tokenIn, pair.tokenOut, size);
        if (!q1) continue;

        for (const sellDex of dexes) {
          if (sellDex.name === buyDex.name) continue;
          const q2 = getQuote(quotes, sellDex.name, pair.tokenOut, pair.tokenIn, size);
          if (!q2) continue;

          const grossProfitTokenRaw = q2.amountOutRaw.sub(q1.amountInRaw);
          const grossProfitUsd = rawToUsd(pair.tokenInSymbol, grossProfitTokenRaw, nativeTokenUsd);
          const flashFeeRaw = q1.amountInRaw.mul(flashPremiumBps()).div(10000);
          const flashFeeUsd = rawToUsd(pair.tokenInSymbol, flashFeeRaw, nativeTokenUsd);
          
          let gasUsd = baseGasUsd2;
          
          const netProfitUsd = grossProfitUsd - gasUsd - flashFeeUsd;

          const route = {
            id: routeId([
              chain.name,
              "2LEG",
              pair.tokenInSymbol,
              pair.tokenOutSymbol,
              buyDex.name,
              sellDex.name,
              String(size),
            ]),
            chain: chain.name,
            shape: "2LEG",
            tokenIn: pair.tokenIn,
            tokenOut: pair.tokenOut,
            tokenInSymbol: pair.tokenInSymbol,
            tokenOutSymbol: pair.tokenOutSymbol,
            amountInRaw: q1.amountInRaw.toString(),
            expectedAmountOutRaw: q2.amountOutRaw.toString(),
            grossProfitTokenRaw: grossProfitTokenRaw.toString(),
            minProfitTokenRaw: usdToMinProfitRaw(
              pair.tokenInSymbol,
              Math.max(Number(process.env.MIN_NET_PROFIT_USD || 0.01), 0.000001),
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
                amountInRaw: q1.amountInRaw,
                quotedOutRaw: q1.amountOutRaw,
              }),
              buildLeg({
                dex: sellDex,
                tokenIn: pair.tokenOut,
                tokenOut: pair.tokenIn,
                amountInRaw: q1.amountOutRaw,
                quotedOutRaw: q2.amountOutRaw,
              }),
            ],
            metadata: {
              amountInUsd: size,
              buyDex: buyDex.name,
              sellDex: sellDex.name,
            },
          };

          if (!seen.has(route.id)) {
            seen.add(route.id);
            routes.push(route);
          }
        }
      }
    }

    for (const cycle of cycles) {
      for (const dex1 of dexes) {
        const q1 = getQuote(quotes, dex1.name, cycle.start, cycle.mid1, size);
        if (!q1) continue;

        for (const dex2 of dexes) {
          const q2Direct = getQuote(quotes, dex2.name, cycle.mid1, cycle.mid2, size);
          if (!q2Direct) continue;

          // rescale leg 2 by actual output of leg 1 is not yet exact in this stage,
          // so we only keep routes where the fixed-size quote is directionally promising.
          // exact dynamic batching is Stage 4.
          for (const dex3 of dexes) {
            const q3Direct = getQuote(quotes, dex3.name, cycle.mid2, cycle.start, size);
            if (!q3Direct) continue;

            const grossProfitTokenRaw = q3Direct.amountOutRaw.sub(q1.amountInRaw);
            const grossProfitUsd = rawToUsd(cycle.startSymbol, grossProfitTokenRaw, nativeTokenUsd);
            const flashFeeRaw = q1.amountInRaw.mul(flashPremiumBps()).div(10000);
            const flashFeeUsd = rawToUsd(cycle.startSymbol, flashFeeRaw, nativeTokenUsd);
            
            let gasUsd = baseGasUsd2;
            try {
              if (!globalGasUsd3) globalGasUsd3 = await getGasUsd(provider, nativeTokenUsd, 3);
              gasUsd = globalGasUsd3;
            } catch {
              gasUsd = Number(process.env.GAS_USD_FALLBACK_3LEG || 0.08);
            }
            
            const netProfitUsd = grossProfitUsd - gasUsd - flashFeeUsd;

            const route = {
              id: routeId([
                chain.name,
                "3LEG",
                cycle.startSymbol,
                cycle.mid1Symbol,
                cycle.mid2Symbol,
                dex1.name,
                dex2.name,
                dex3.name,
                String(size),
              ]),
              chain: chain.name,
              shape: "3LEG",
              tokenIn: cycle.start,
              tokenOut: cycle.start,
              tokenInSymbol: cycle.startSymbol,
              tokenOutSymbol: cycle.startSymbol,
              amountInRaw: q1.amountInRaw.toString(),
              expectedAmountOutRaw: q3Direct.amountOutRaw.toString(),
              grossProfitTokenRaw: grossProfitTokenRaw.toString(),
              minProfitTokenRaw: usdToMinProfitRaw(
                cycle.startSymbol,
                Math.max(Number(process.env.MIN_NET_PROFIT_USD || 0.01), 0.000001),
                nativeTokenUsd
              ).toString(),
              grossProfitUsd,
              gasUsd,
              flashFeeUsd,
              netProfitUsd,
              deadline: getDeadline(),
              legs: [
                buildLeg({
                  dex: dex1,
                  tokenIn: cycle.start,
                  tokenOut: cycle.mid1,
                  amountInRaw: q1.amountInRaw,
                  quotedOutRaw: q1.amountOutRaw,
                }),
                buildLeg({
                  dex: dex2,
                  tokenIn: cycle.mid1,
                  tokenOut: cycle.mid2,
                  amountInRaw: q2Direct.amountInRaw,
                  quotedOutRaw: q2Direct.amountOutRaw,
                }),
                buildLeg({
                  dex: dex3,
                  tokenIn: cycle.mid2,
                  tokenOut: cycle.start,
                  amountInRaw: q3Direct.amountInRaw,
                  quotedOutRaw: q3Direct.amountOutRaw,
                }),
              ],
              metadata: {
                amountInUsd: size,
                dex1: dex1.name,
                dex2: dex2.name,
                dex3: dex3.name,
                pivot: "WMATIC",
                note: "Stage 3 batched triangular approximation; exact propagated sizing comes next.",
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
  }

  const positive = routes
    .filter((r) => Number.isFinite(r.netProfitUsd))
    .sort((a, b) => Number(b.netProfitUsd) - Number(a.netProfitUsd));

  const bestRoute = positive[0] || null;

  return {
    ok: !!bestRoute,
    reason: bestRoute ? null : "NO_ROUTE",
    bestRoute,
    routes: positive.slice(0, 50),
  };
}

// Compatibility shim
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
