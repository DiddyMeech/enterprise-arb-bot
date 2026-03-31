const { ethers } = require("ethers");

const HUB_TOKENS = {
  USDC: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
  WMATIC: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270",
  WETH: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619",
  USDT: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
  DAI: "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063",
};

const COINGECKO_POLYGON_LIST =
  "https://tokens.coingecko.com/polygon-pos/all.json";

let rollingCursor = 0;

function envNum(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) ? n : fallback;
}

function envBool(name, fallback = false) {
  const v = process.env[name];
  if (v == null || v === "") return fallback;
  return String(v).toLowerCase() === "true";
}

function envStr(name, fallback = "") {
  const v = process.env[name];
  return v == null || v === "" ? fallback : String(v);
}

function getTargetSpokeCount() {
  return envNum("DYNAMIC_SPOKE_COUNT", 40);
}

function getSourceSpokeCount() {
  return envNum("DYNAMIC_SPOKE_SOURCE_COUNT", 120);
}

function getOffsetStep() {
  return envNum("DYNAMIC_SPOKE_OFFSET_STEP", getTargetSpokeCount());
}

function getOffsetMode() {
  return envStr("DYNAMIC_SPOKE_OFFSET_MODE", "rolling").toLowerCase();
}

function getFixedOffset() {
  return envNum("DYNAMIC_SPOKE_FIXED_OFFSET", 0);
}

function getRunSalt() {
  return envStr("DYNAMIC_UNIVERSE_RUN_SALT", "");
}

function getStaticSpokes() {
  return envStr("STATIC_SPOKE_TOKENS", "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const [symbol, address] = entry.split(":").map((x) => x.trim());
      if (!symbol || !address) return null;
      try {
        return {
          symbol: symbol.toUpperCase(),
          address: ethers.utils.getAddress(address),
          isHub: false,
          source: "static-env",
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

// Minimum market cap (USD) a spoke token must have to be included.
// This filters out micro-caps / meme coins that have no real on-chain liquidity.
const MIN_SPOKE_MARKET_CAP_USD = 1_000_000; // $1 M floor

// Fallback: well-known liquid Polygon ERC-20s used when CoinGecko is unreachable.
const FALLBACK_SPOKE_TOKENS = [
  { symbol: "LINK",  address: "0x53E0bca35eC356BD5ddDFebbD1Fc0fD03FaBad39" },
  { symbol: "AAVE",  address: "0xD6DF932A45C0f255f85145f286eA0b292B21C90B" },
  { symbol: "CRV",   address: "0x172370d5Cd63279eFa6d502DAB29171933a610AF" },
  { symbol: "BAL",   address: "0x9a71012B13CA4d3D0Cdc72A177DF3ef03b0E76A7" },
  { symbol: "GHO",   address: "0x97Ab79B80Fa4a12D90b6be11C5A8d4E4F73cEBb2" },
  { symbol: "stMATIC", address: "0x3A58a54C066FdC0f2D55FC9C89F0415C92eBf3C6" },
  { symbol: "MaticX", address: "0xfa68FB4628DFF1028CFEc22b4162FCcd0d45efb6" },
  { symbol: "SAND",  address: "0xBbba073C31bF03b8ACf7c28EF0738DeCF3695683" },
  { symbol: "GHST",  address: "0x385Eeac5cB85A38A9a07A70c73e0a3271CfB54A7" },
  { symbol: "QUICK", address: "0xB5C064F955D8e7F38fE0460C556a72987494eE17" },
  { symbol: "DPI",   address: "0x85955046DF4668e1DD369D2DE9f3AEB98DD2A369" },
  { symbol: "MKR",   address: "0x6f7C932e7684666C9fd1d44527765433e01fF61d" },
  { symbol: "SUSHI", address: "0x0b3F868E0BE5597D5DB7fEB59E1CADBb0fdDa50a" },
  { symbol: "SNX",   address: "0x50B728D8D964fd00C2d0AAD81718b71311feF68a" },
  { symbol: "FXS",   address: "0x3e121107F6F22DA4911079845a470757aF4e1A1b" },
];

async function fetchDynamicSpokes(targetCount = 120) {
  try {
    // CoinGecko's /all.json list does not include market cap data.
    // We use the markets endpoint for top Polygon tokens sorted by market cap.
    const marketsUrl =
      "https://api.coingecko.com/api/v3/coins/markets" +
      "?vs_currency=usd&category=polygon-ecosystem&order=market_cap_desc" +
      `&per_page=${Math.min(targetCount * 3, 250)}&page=1` +
      "&sparkline=false&price_change_percentage=24h";

    const response = await fetch(marketsUrl, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      throw new Error(`HTTP_${response.status}`);
    }

    const coins = await response.json();
    if (!Array.isArray(coins) || coins.length === 0) {
      throw new Error("EMPTY_MARKETS_RESPONSE");
    }

    const hubAddresses = Object.values(HUB_TOKENS).map((a) => a.toLowerCase());

    const validSpokes = [];
    for (const coin of coins) {
      // Must have a Polygon contract address
      const raw =
        coin?.platforms?.["polygon-pos"] ||
        coin?.platforms?.["polygon"] ||
        "";
      if (!raw) continue;

      let address;
      try {
        address = ethers.utils.getAddress(raw);
      } catch {
        continue;
      }

      if (hubAddresses.includes(address.toLowerCase())) continue;

      // Enforce market-cap floor to exclude micro-caps
      const mcap = Number(coin.market_cap);
      if (!mcap || mcap < MIN_SPOKE_MARKET_CAP_USD) continue;

      validSpokes.push({
        symbol: String(coin.symbol).toUpperCase(),
        address,
        isHub: false,
        source: "coingecko-markets",
        marketCapUsd: mcap,
      });

      if (validSpokes.length >= targetCount) break;
    }

    if (validSpokes.length === 0) {
      throw new Error("NO_VALID_SPOKES_AFTER_FILTER");
    }

    console.log(
      `[dynamic-universe] fetched ${validSpokes.length} liquid spokes` +
        ` (min mcap $${(MIN_SPOKE_MARKET_CAP_USD / 1e6).toFixed(1)}M)`
    );
    return validSpokes;
  } catch (error) {
    console.warn(
      "[dynamic-universe] FAILED_TO_FETCH_DYNAMIC_SPOKES:",
      error.message,
      "— using fallback spoke list"
    );
    // Return the hardcoded fallback so the universe is never empty
    return FALLBACK_SPOKE_TOKENS.map((t) => ({
      symbol: t.symbol,
      address: ethers.utils.getAddress(t.address),
      isHub: false,
      source: "fallback-hardcoded",
    }));
  }
}

function dedupeUniverse(tokens) {
  const seen = new Map();

  for (const token of tokens) {
    const key = String(token.address).toLowerCase();
    if (!seen.has(key)) {
      seen.set(key, token);
    }
  }

  return [...seen.values()];
}

function computeWindowOffset(totalSpokes, windowSize) {
  if (totalSpokes <= 0) return 0;
  if (windowSize >= totalSpokes) return 0;

  const mode = getOffsetMode();

  if (mode === "fixed") {
    return Math.max(0, Math.min(getFixedOffset(), totalSpokes - 1));
  }

  if (mode === "salted") {
    const salt = getRunSalt();
    let hash = 0;
    for (let i = 0; i < salt.length; i++) {
      hash = (hash * 31 + salt.charCodeAt(i)) >>> 0;
    }
    return hash % totalSpokes;
  }

  // default: rolling
  const offset = rollingCursor % totalSpokes;
  rollingCursor = (rollingCursor + getOffsetStep()) % totalSpokes;
  return offset;
}

function sliceRollingWindow(spokes, windowSize) {
  if (windowSize <= 0) return [];
  if (spokes.length <= windowSize) return spokes.slice();

  const offset = computeWindowOffset(spokes.length, windowSize);
  const out = [];

  for (let i = 0; i < windowSize; i++) {
    out.push(spokes[(offset + i) % spokes.length]);
  }

  return out;
}

function buildUniverseFingerprint(hubs, spokes, selectedSpokes) {
  return {
    hubCount: hubs.length,
    totalFetchedSpokes: spokes.length,
    selectedSpokeCount: selectedSpokes.length,
    offsetMode: getOffsetMode(),
    offsetStep: getOffsetStep(),
    fixedOffset: getFixedOffset(),
    runSalt: getRunSalt() || null,
    selectedSymbolsPreview: selectedSpokes.slice(0, 8).map((t) => t.symbol),
  };
}

async function buildDynamicUniverse() {
  const hubs = Object.entries(HUB_TOKENS).map(([symbol, address]) => ({
    symbol,
    address: ethers.utils.getAddress(address),
    isHub: true,
    source: "hardcoded-hub",
  }));

  const staticSpokes = getStaticSpokes();
  const fetchedSpokes = envBool("ENABLE_DYNAMIC_SPOKES", true)
    ? await fetchDynamicSpokes(getSourceSpokeCount())
    : [];

  const dedupedSpokes = dedupeUniverse([...staticSpokes, ...fetchedSpokes]).filter(
    (t) => !t.isHub
  );

  const selectedSpokes = sliceRollingWindow(
    dedupedSpokes,
    getTargetSpokeCount()
  );

  const universe = dedupeUniverse([...hubs, ...selectedSpokes]);

  return {
    universe,
    fingerprint: buildUniverseFingerprint(hubs, dedupedSpokes, selectedSpokes),
  };
}

function buildHubAndSpokeCycles(universe) {
  const out = [];
  const hubs = universe.filter((t) => t.isHub);
  const spokes = universe.filter((t) => !t.isHub);

  // Hub -> Spoke -> Hub
  for (const startHub of hubs) {
    for (const midSpoke of spokes) {
      for (const endHub of hubs) {
        if (startHub.address === endHub.address) continue;

        out.push({
          shape: "3LEG",
          startSymbol: startHub.symbol,
          start: startHub.address,
          mid1Symbol: midSpoke.symbol,
          mid1: midSpoke.address,
          mid2Symbol: endHub.symbol,
          mid2: endHub.address,
          topology: "hub-spoke-hub",
        });
      }
    }
  }

  // Hub -> Hub -> Spoke
  for (const startHub of hubs) {
    for (const midHub of hubs) {
      if (startHub.address === midHub.address) continue;

      for (const endSpoke of spokes) {
        out.push({
          shape: "3LEG",
          startSymbol: startHub.symbol,
          start: startHub.address,
          mid1Symbol: midHub.symbol,
          mid1: midHub.address,
          mid2Symbol: endSpoke.symbol,
          mid2: endSpoke.address,
          topology: "hub-hub-spoke",
        });
      }
    }
  }

  return out;
}

function buildHubPairs(universe) {
  const hubs = universe.filter((t) => t.isHub);
  const out = [];

  for (let i = 0; i < hubs.length; i++) {
    for (let j = i + 1; j < hubs.length; j++) {
      out.push({
        tokenInSymbol: hubs[i].symbol,
        tokenIn: hubs[i].address,
        tokenOutSymbol: hubs[j].symbol,
        tokenOut: hubs[j].address,
        shape: "2LEG",
      });
    }
  }

  return out;
}

module.exports = {
  HUB_TOKENS,
  buildDynamicUniverse,
  buildHubAndSpokeCycles,
  buildHubPairs,
};
