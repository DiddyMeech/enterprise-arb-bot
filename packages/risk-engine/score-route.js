function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function getRouteDrift(route) {
  const approx = num(route?.metadata?.approximateNetProfitUsd, null);
  const exact = num(route?.netProfitUsd, null);

  if (approx === null || exact === null) {
    return {
      hasDriftData: false,
      driftUsd: 0,
      driftPct: 0,
    };
  }

  const driftUsd = Math.abs(approx - exact);
  const denom = Math.max(Math.abs(approx), 0.000001);

  return {
    hasDriftData: true,
    driftUsd,
    driftPct: driftUsd / denom,
  };
}

function getExecutionSlippage(route) {
  return num(route?.metadata?.executionSlippageBps, 0);
}

function getDiscoverySlippage(route) {
  return num(route?.metadata?.discoverySlippageBps, 0);
}

function getLegCount(route) {
  return Array.isArray(route?.legs) ? route.legs.length : 99;
}

function getExactBonus(route) {
  return route?.metadata?.exactRequoted === true ? 10 : 0;
}

function getPropagatedBonus(route) {
  return route?.metadata?.sizingMode === "propagated" ? 8 : 0;
}

function getDexDiversityBonus(route) {
  const dexes = new Set(
    (route?.legs || [])
      .map((l) => String(l?.dex || "").toLowerCase())
      .filter(Boolean)
  );
  return dexes.size >= 2 ? 3 : 0;
}

function classifyRoute(route) {
  const net = num(route?.netProfitUsd, -999999);
  const gross = num(route?.grossProfitUsd, -999999);
  const gas = num(route?.gasUsd, 0);
  const drift = getRouteDrift(route);
  const exact = route?.metadata?.exactRequoted === true;
  const propagated = route?.metadata?.sizingMode === "propagated";

  if (!exact || !propagated) return "reject";
  if (!(gross > 0) || !(net > 0)) return "reject";
  if (gas > Math.max(gross, 0.000001) * 0.75) return "reject";

  if (drift.hasDriftData) {
    if (drift.driftPct > 1.0) return "near_miss";
    if (drift.driftPct > 0.35) return "candidate";
  }

  if (net >= 0.10 && gross >= 0.15) return "strong_candidate";
  if (net >= 0.03 && gross > 0) return "candidate";

  return "near_miss";
}

function bucketWeight(bucket) {
  switch (bucket) {
    case "strong_candidate":
      return 1000;
    case "candidate":
      return 500;
    case "near_miss":
      return 100;
    default:
      return 0;
  }
}

function dexInefficiencyBonus(route) {
  const dexes = (route?.legs || [])
    .map((l) => String(l?.dex || "").toLowerCase());

  let bonus = 0;

  for (const dex of dexes) {
    if (["apeswap", "dfyn", "meshswap"].includes(dex)) {
      bonus += 5;
    }
  }

  return bonus;
}

function scoreRoute(route) {
  const net = num(route?.netProfitUsd, -999999);
  const gross = num(route?.grossProfitUsd, -999999);
  const gas = num(route?.gasUsd, 0);
  const legCount = getLegCount(route);
  const drift = getRouteDrift(route);
  const execSlip = getExecutionSlippage(route);
  const discSlip = getDiscoverySlippage(route);
  const bucket = classifyRoute(route);

  let score = 0;

  score += bucketWeight(bucket);

  score += net * 100;
  score += gross * 40;
  score -= gas * 20;

  score += getExactBonus(route);
  score += getPropagatedBonus(route);
  score += getDexDiversityBonus(route);

  score -= Math.max(0, legCount - 2) * 5;

  if (drift.hasDriftData) {
    score -= drift.driftUsd * 20;
    score -= drift.driftPct * 25;
  }

  score -= execSlip * 0.2;
  if (route.gasUsd > 0.05) {
    score -= (route.gasUsd * 10);
  }

  score += dexInefficiencyBonus(route);

  return Number(score.toFixed(6));
}

function enrichRouteScore(route) {
  const drift = getRouteDrift(route);
  const bucket = classifyRoute(route);
  const score = scoreRoute(route);

  return {
    ...route,
    ranking: {
      score,
      bucket,
      scoreVersion: "v2-bucketed",
      inefficiencyBonus: dexInefficiencyBonus(route),
      driftUsd: drift.driftUsd,
      driftPct: drift.driftPct,
      legCount: getLegCount(route),
      executionSlippageBps: getExecutionSlippage(route),
      discoverySlippageBps: getDiscoverySlippage(route),
      exactRequoted: route?.metadata?.exactRequoted === true,
      sizingMode: route?.metadata?.sizingMode || null,
    },
  };
}

function rankRoutes(routes = []) {
  return routes
    .map(enrichRouteScore)
    .sort((a, b) => Number(b?.ranking?.score || -999999) - Number(a?.ranking?.score || -999999));
}

function topRoutesByBucket(routes = []) {
  const ranked = rankRoutes(routes);
  return {
    strong_candidate: ranked.filter((r) => r?.ranking?.bucket === "strong_candidate"),
    candidate: ranked.filter((r) => r?.ranking?.bucket === "candidate"),
    near_miss: ranked.filter((r) => r?.ranking?.bucket === "near_miss"),
    reject: ranked.filter((r) => r?.ranking?.bucket === "reject"),
  };
}

module.exports = {
  scoreRoute,
  enrichRouteScore,
  rankRoutes,
  classifyRoute,
  topRoutesByBucket,
};
