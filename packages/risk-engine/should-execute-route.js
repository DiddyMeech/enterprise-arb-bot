function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function envNum(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) ? n : fallback;
}

function getLiveSafetyConfig() {
  return {
    minGrossProfitUsd: envNum("MIN_GROSS_PROFIT_USD", 0.03),
    minNetProfitUsd: envNum("MIN_NET_PROFIT_USD", 0.01),
    maxGasToGrossRatio: envNum("MAX_GAS_TO_GROSS_RATIO", 0.5),
    maxRouteLegs: envNum("MAX_ROUTE_LEGS", 3),
    maxQuoteAgeSec: envNum("MAX_QUOTE_AGE_SEC", 12),
    requirePropagatedSizing:
      String(process.env.REQUIRE_PROPAGATED_SIZING || "true").toLowerCase() === "true",
    requireExactRequote:
      String(process.env.REQUIRE_EXACT_REQUOTE || "true").toLowerCase() === "true",
    requirePositiveGross:
      String(process.env.REQUIRE_POSITIVE_GROSS || "true").toLowerCase() === "true",
    requirePositiveNet:
      String(process.env.REQUIRE_POSITIVE_NET || "true").toLowerCase() === "true",
    maxApproxToExactDriftUsd: envNum("MAX_APPROX_TO_EXACT_DRIFT_USD", 0.15),
    maxApproxToExactDriftPct: envNum("MAX_APPROX_TO_EXACT_DRIFT_PCT", 0.5),
    maxDeadlineAheadSec: envNum("MAX_DEADLINE_AHEAD_SEC", 120),
    maxExecutionSlippageBps: envNum("MAX_EXECUTION_SLIPPAGE_BPS", 35),
  };
}

function computeApproxExactDrift(route) {
  const approxNet = num(route?.metadata?.approximateNetProfitUsd, null);
  const exactNet = num(route?.netProfitUsd, null);

  if (approxNet === null || exactNet === null) {
    return {
      hasDriftData: false,
      driftUsd: null,
      driftPct: null,
    };
  }

  const driftUsd = Math.abs(approxNet - exactNet);
  const denom = Math.max(Math.abs(approxNet), 0.000001);
  const driftPct = driftUsd / denom;

  return {
    hasDriftData: true,
    driftUsd,
    driftPct,
  };
}

function shouldExecuteRoute(route, options = {}) {
  const cfg = {
    ...getLiveSafetyConfig(),
    ...(options.config || {}),
  };

  const reasons = [];
  if (!route || typeof route !== "object") {
    return { ok: false, reasons: ["MISSING_ROUTE"], checks: {} };
  }

  const grossProfitUsd = num(route.grossProfitUsd);
  const netProfitUsd = num(route.netProfitUsd);
  const gasUsd = num(route.gasUsd);
  const deadline = num(route.deadline);
  const legs = Array.isArray(route.legs) ? route.legs : [];
  const metadata = route.metadata || {};

  const sizingMode = String(metadata.sizingMode || "");
  const exactRequoted = metadata.exactRequoted === true;

  const createdAtSec = num(metadata.createdAtSec || metadata.quoteCreatedAtSec || 0);
  const now = nowSec();

  if (cfg.requirePositiveGross && !(grossProfitUsd > 0)) {
    reasons.push("NO_GROSS_EDGE");
  }

  if (cfg.requirePositiveNet && !(netProfitUsd > 0)) {
    reasons.push("NO_NET_EDGE");
  }

  if (grossProfitUsd < cfg.minGrossProfitUsd) {
    reasons.push("LOW_GROSS_PROFIT");
  }

  if (netProfitUsd < cfg.minNetProfitUsd) {
    reasons.push("LOW_NET_PROFIT");
  }

  if (grossProfitUsd > 0) {
    const gasToGrossRatio = gasUsd / grossProfitUsd;
    if (gasToGrossRatio > cfg.maxGasToGrossRatio) {
      reasons.push("GAS_TOO_HIGH");
    }
  }

  if (cfg.requirePropagatedSizing && sizingMode !== "propagated") {
    reasons.push("UNPROPAGATED_SIZE");
  }

  if (cfg.requireExactRequote && !exactRequoted) {
    reasons.push("NOT_EXACT_REQUOTED");
  }

  if (!legs.length) {
    reasons.push("NO_LEGS");
  }

  if (legs.length > cfg.maxRouteLegs) {
    reasons.push("TOO_MANY_LEGS");
  }

  if (deadline <= now) {
    reasons.push("STALE_ROUTE");
  }

  if (deadline > now + cfg.maxDeadlineAheadSec) {
    reasons.push("DEADLINE_TOO_FAR");
  }

  if (createdAtSec > 0 && now - createdAtSec > cfg.maxQuoteAgeSec) {
    reasons.push("QUOTE_TOO_OLD");
  }

  const executionSlippage = num(metadata.executionSlippageBps, null);
  if (
    executionSlippage !== null &&
    executionSlippage > cfg.maxExecutionSlippageBps
  ) {
    reasons.push("EXECUTION_SLIPPAGE_TOO_HIGH");
  }

  const drift = computeApproxExactDrift(route);
  if (drift.hasDriftData) {
    if (drift.driftUsd > cfg.maxApproxToExactDriftUsd) {
      reasons.push("APPROX_EXACT_DRIFT_TOO_HIGH_USD");
    }
    if (drift.driftPct > cfg.maxApproxToExactDriftPct) {
      reasons.push("APPROX_EXACT_DRIFT_TOO_HIGH_PCT");
    }
  }

  return {
    ok: reasons.length === 0,
    reasons,
    checks: {
      grossProfitUsd,
      netProfitUsd,
      gasUsd,
      sizingMode,
      exactRequoted,
      legCount: legs.length,
      deadline,
      now,
      drift,
      config: cfg,
    },
  };
}

module.exports = {
  shouldExecuteRoute,
  getLiveSafetyConfig,
};
