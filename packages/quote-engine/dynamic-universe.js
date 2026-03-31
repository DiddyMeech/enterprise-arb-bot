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

async function fetchDynamicSpokes(targetCount = 120) {
  try {
    const response = await fetch(COINGECKO_POLYGON_LIST);
    if (!response.ok) {
      throw new Error(`HTTP_${response.status}`);
    }

    const data = await response.json();
    const allTokens = Array.isArray(data.tokens) ? data.tokens : [];
    const hubAddresses = Object.values(HUB_TOKENS).map((a) => a.toLowerCase());

    const validSpokes = allTokens.filter((t) => {
      if (!t || Number(t.chainId) !== 137) return false;
      if (!t.address || !t.symbol) return false;
      if (hubAddresses.includes(String(t.address).toLowerCase())) return false;
      return true;
    });

    return validSpokes.slice(0, targetCount).map((t) => ({
      symbol: String(t.symbol).toUpperCase(),
      address: ethers.utils.getAddress(t.address),
      isHub: false,
      source: "coingecko",
    }));
  } catch (error) {
    console.error(
      "[dynamic-universe] FAILED_TO_FETCH_DYNAMIC_SPOKES:",
      error.message
    );
    return [];
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
