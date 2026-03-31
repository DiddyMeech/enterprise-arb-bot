function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function envNum(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) ? n : fallback;
}

function getFamilyPriorityConfig() {
  return {
    minExcludeSamples: envNum("FAMILY_MIN_EXCLUDE_SAMPLES", 5),
    minPrioritizeSamples: envNum("FAMILY_MIN_PRIORITIZE_SAMPLES", 3),

    excludeAvgScoreBelow: envNum("FAMILY_EXCLUDE_AVG_SCORE_BELOW", -20),
    excludeAvgDriftPctAbove: envNum("FAMILY_EXCLUDE_AVG_DRIFT_PCT_ABOVE", 1.0),

    prioritizeAvgDriftPctBelow: envNum("FAMILY_PRIORITIZE_AVG_DRIFT_PCT_BELOW", 0.50),
    prioritizeAvgScoreAbove: envNum("FAMILY_PRIORITIZE_AVG_SCORE_ABOVE", -2),

    cooldownMs: envNum("FAMILY_POLICY_COOLDOWN_MS", 30 * 60 * 1000),
    priorityScoreBoost: envNum("FAMILY_PRIORITY_SCORE_BOOST", 25),
    cooldownScorePenalty: envNum("FAMILY_COOLDOWN_SCORE_PENALTY", 15),
    excludeScorePenalty: envNum("FAMILY_EXCLUDE_SCORE_PENALTY", 1000),
  };
}

function nowMs() {
  return Date.now();
}

const familyPolicyState = new Map();

function getFamilyState(familyKey) {
  return (
    familyPolicyState.get(familyKey) || {
      familyKey,
      lastPolicyAt: 0,
      lastCooldownAt: 0,
      lastExcludeAt: 0,
      lastPrioritizeAt: 0,
      policy: "neutral",
    }
  );
}

function setFamilyState(familyKey, patch) {
  const current = getFamilyState(familyKey);
  const next = { ...current, ...patch };
  familyPolicyState.set(familyKey, next);
  return next;
}

function isCoolingDown(familyKey) {
  const cfg = getFamilyPriorityConfig();
  const state = getFamilyState(familyKey);
  if (state.policy !== "cooldown") return false;
  return nowMs() - state.lastCooldownAt < cfg.cooldownMs;
}

function familyUsesOnlyEfficientDexes(familyKey) {
  const key = String(familyKey || "").toLowerCase();
  const efficient = ["quickswap", "univ3", "sushi"];
  const inefficient = ["apeswap", "dfyn", "meshswap"];

  const hasEfficient = efficient.some((d) => key.includes(d));
  const hasInefficient = inefficient.some((d) => key.includes(d));

  return hasEfficient && !hasInefficient;
}

function classifyFamilyPriority(family) {
  const cfg = getFamilyPriorityConfig();

  const total = num(family?.total, 0);
  const dominantBucket = String(family?.dominantBucket || "unknown");
  const avgScore = num(family?.avgScore, 0);
  const avgDriftPct = num(family?.avgDriftPct, 0);

  if (
    total >= cfg.minExcludeSamples &&
    dominantBucket === "reject" &&
    avgScore <= cfg.excludeAvgScoreBelow &&
    avgDriftPct >= cfg.excludeAvgDriftPctAbove
  ) {
    return "exclude";
  }

  if (
    total >= cfg.minPrioritizeSamples &&
    (dominantBucket === "candidate" || dominantBucket === "near_miss" || dominantBucket === "strong_candidate") &&
    avgDriftPct <= cfg.prioritizeAvgDriftPctBelow &&
    avgScore >= cfg.prioritizeAvgScoreAbove
  ) {
    return "prioritize";
  }

  if (
    total >= cfg.minPrioritizeSamples &&
    dominantBucket === "reject" &&
    avgDriftPct >= 0.75
  ) {
    return "cooldown";
  }

  if (
    total >= cfg.minExcludeSamples &&
    dominantBucket === "reject" &&
    familyUsesOnlyEfficientDexes(family.familyKey)
  ) {
    return "cooldown";
  }

  return "neutral";
}

function updateFamilyPriorityState(family) {
  const familyKey = String(family?.familyKey || "");
  if (!familyKey) return null;

  const policy = classifyFamilyPriority(family);
  const patch = {
    policy,
    lastPolicyAt: nowMs(),
  };

  if (policy === "exclude") patch.lastExcludeAt = nowMs();
  if (policy === "cooldown") patch.lastCooldownAt = nowMs();
  if (policy === "prioritize") patch.lastPrioritizeAt = nowMs();

  return setFamilyState(familyKey, patch);
}

function shouldExcludeFamily(family) {
  const familyKey = String(family?.familyKey || "");
  if (!familyKey) return false;

  const state = getFamilyState(familyKey);
  if (state.policy === "exclude") return true;

  return classifyFamilyPriority(family) === "exclude";
}

function shouldCooldownFamily(family) {
  const familyKey = String(family?.familyKey || "");
  if (!familyKey) return false;

  if (isCoolingDown(familyKey)) return true;

  return classifyFamilyPriority(family) === "cooldown";
}

function shouldPrioritizeFamily(family) {
  const familyKey = String(family?.familyKey || "");
  if (!familyKey) return false;

  const state = getFamilyState(familyKey);
  if (state.policy === "prioritize") return true;

  return classifyFamilyPriority(family) === "prioritize";
}

function applyFamilyPriorityToScore(route, familySummary) {
  const cfg = getFamilyPriorityConfig();
  const currentScore = num(route?.ranking?.score, -999999);

  const familyKey = String(familySummary?.familyKey || "");
  const state = familyKey ? getFamilyState(familyKey) : null;

  let adjustedScore = currentScore;
  let familyPolicy = state?.policy || classifyFamilyPriority(familySummary);

  if (familyPolicy === "prioritize") {
    adjustedScore += cfg.priorityScoreBoost;
  } else if (familyPolicy === "cooldown") {
    adjustedScore -= cfg.cooldownScorePenalty;
  } else if (familyPolicy === "exclude") {
    adjustedScore -= cfg.excludeScorePenalty;
  }

  return {
    ...route,
    ranking: {
      ...(route?.ranking || {}),
      familyPolicy,
      adjustedScore: Number(adjustedScore.toFixed(6)),
    },
    metadata: {
      ...(route?.metadata || {}),
      familyPolicy,
      familyKey,
    },
  };
}

module.exports = {
  getFamilyPriorityConfig,
  classifyFamilyPriority,
  updateFamilyPriorityState,
  shouldExcludeFamily,
  shouldCooldownFamily,
  shouldPrioritizeFamily,
  applyFamilyPriorityToScore,
  getFamilyState,
};
