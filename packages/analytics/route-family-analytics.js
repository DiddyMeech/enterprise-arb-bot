function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function getRouteFamilyKey(route) {
  const legs = Array.isArray(route?.legs) ? route.legs : [];
  const dexPath = legs.map((l) => String(l?.dex || "").toLowerCase()).join("->");
  const symbolPath = [
    route?.tokenInSymbol || "unknown",
    ...legs.map((l) => String(l?.tokenOutSymbol || l?.tokenOut || "unknown")),
  ].join("->");

  return [
    route?.shape || "unknown",
    route?.tokenInSymbol || "unknown",
    route?.tokenOutSymbol || "unknown",
    dexPath,
    symbolPath,
  ].join("|");
}

function initFamily(key) {
  return {
    familyKey: key,
    total: 0,
    buckets: {
      strong_candidate: 0,
      candidate: 0,
      near_miss: 0,
      reject: 0,
      unknown: 0,
    },
    scores: [],
    netProfitUsd: [],
    grossProfitUsd: [],
    gasUsd: [],
    driftPct: [],
    driftUsd: [],
    examples: [],
  };
}

function pushBounded(arr, value, max = 5) {
  arr.push(value);
  while (arr.length > max) arr.shift();
}

function summarizeFamily(f) {
  const avg = (arr) =>
    arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

  const bestScore = f.scores.length ? Math.max(...f.scores) : null;
  const worstScore = f.scores.length ? Math.min(...f.scores) : null;
  const avgScore = avg(f.scores);
  const avgNet = avg(f.netProfitUsd);
  const avgGross = avg(f.grossProfitUsd);
  const avgGas = avg(f.gasUsd);
  const avgDriftPct = avg(f.driftPct);
  const avgDriftUsd = avg(f.driftUsd);

  let dominantBucket = "unknown";
  let dominantCount = -1;

  for (const [bucket, count] of Object.entries(f.buckets)) {
    if (count > dominantCount) {
      dominantBucket = bucket;
      dominantCount = count;
    }
  }

  return {
    familyKey: f.familyKey,
    total: f.total,
    dominantBucket,
    buckets: f.buckets,
    bestScore,
    worstScore,
    avgScore,
    avgNetProfitUsd: avgNet,
    avgGrossProfitUsd: avgGross,
    avgGasUsd: avgGas,
    avgDriftPct,
    avgDriftUsd,
    examples: f.examples,
  };
}

function aggregateRouteFamilies(routes = []) {
  const families = new Map();

  for (const route of routes) {
    const familyKey = getRouteFamilyKey(route);
    if (!families.has(familyKey)) {
      families.set(familyKey, initFamily(familyKey));
    }

    const item = families.get(familyKey);
    const ranking = route?.ranking || {};
    const bucket = String(ranking.bucket || "unknown");

    item.total += 1;
    item.buckets[bucket] = (item.buckets[bucket] || 0) + 1;

    item.scores.push(num(ranking.score, 0));
    item.netProfitUsd.push(num(route?.netProfitUsd, 0));
    item.grossProfitUsd.push(num(route?.grossProfitUsd, 0));
    item.gasUsd.push(num(route?.gasUsd, 0));
    item.driftPct.push(num(ranking.driftPct, 0));
    item.driftUsd.push(num(ranking.driftUsd, 0));

    pushBounded(item.examples, {
      routeId: route?.id || null,
      bucket,
      score: num(ranking.score, 0),
      netProfitUsd: num(route?.netProfitUsd, 0),
      grossProfitUsd: num(route?.grossProfitUsd, 0),
      driftPct: num(ranking.driftPct, 0),
    });
  }

  return [...families.values()].map(summarizeFamily);
}

function rankFamilies(families = []) {
  return [...families].sort((a, b) => {
    const bucketWeight = (bucket) => {
      switch (bucket) {
        case "strong_candidate":
          return 4;
        case "candidate":
          return 3;
        case "near_miss":
          return 2;
        case "reject":
          return 1;
        default:
          return 0;
      }
    };

    const bucketDelta =
      bucketWeight(b.dominantBucket) - bucketWeight(a.dominantBucket);
    if (bucketDelta !== 0) return bucketDelta;

    const scoreDelta = num(b.avgScore, -999999) - num(a.avgScore, -999999);
    if (scoreDelta !== 0) return scoreDelta;

    return num(b.avgNetProfitUsd, -999999) - num(a.avgNetProfitUsd, -999999);
  });
}

function topFamiliesByBucket(families = []) {
  const ranked = rankFamilies(families);

  return {
    strong_candidate: ranked.filter((f) => f.dominantBucket === "strong_candidate"),
    candidate: ranked.filter((f) => f.dominantBucket === "candidate"),
    near_miss: ranked.filter((f) => f.dominantBucket === "near_miss"),
    reject: ranked.filter((f) => f.dominantBucket === "reject"),
  };
}

module.exports = {
  getRouteFamilyKey,
  aggregateRouteFamilies,
  rankFamilies,
  topFamiliesByBucket,
};
