function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function bnStringPositive(v) {
  try {
    return BigInt(String(v)) > 0n;
  } catch {
    return false;
  }
}

function envNum(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) ? n : fallback;
}

function getExecutionConfig() {
  return {
    maxRouteLegs: envNum("MAX_ROUTE_LEGS", 3),
    minDeadlineRemainingSec: envNum("MIN_DEADLINE_REMAINING_SEC", 3),
    requirePropagatedSizing:
      String(process.env.REQUIRE_PROPAGATED_SIZING || "true").toLowerCase() === "true",
    requireExactRequote:
      String(process.env.REQUIRE_EXACT_REQUOTE || "true").toLowerCase() === "true",
  };
}

function validateLegContinuity(route) {
  const reasons = [];
  const legs = Array.isArray(route?.legs) ? route.legs : [];

  if (!legs.length) {
    reasons.push("NO_LEGS");
    return reasons;
  }

  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i];

    if (!leg.tokenIn || !leg.tokenOut) {
      reasons.push(`LEG_${i}_MISSING_TOKEN`);
    }

    if (!bnStringPositive(leg.amountInRaw)) {
      reasons.push(`LEG_${i}_ZERO_AMOUNT_IN`);
    }

    if (!bnStringPositive(leg.minOutRaw)) {
      reasons.push(`LEG_${i}_ZERO_MIN_OUT`);
    }

    if (!leg.router) {
      reasons.push(`LEG_${i}_MISSING_ROUTER`);
    }

    if (i < legs.length - 1) {
      const next = legs[i + 1];
      if (
        String(leg.tokenOut || "").toLowerCase() !==
        String(next.tokenIn || "").toLowerCase()
      ) {
        reasons.push(`LEG_${i}_TO_${i + 1}_TOKEN_BREAK`);
      }
    }
  }

  if (legs.length >= 2) {
    const first = legs[0];
    const last = legs[legs.length - 1];

    if (
      route.shape === "3LEG" &&
      String(first.tokenIn || "").toLowerCase() !==
        String(last.tokenOut || "").toLowerCase()
    ) {
      reasons.push("NON_CYCLIC_TRIANGLE");
    }
  }

  return reasons;
}

function shouldBuildExecution(route, options = {}) {
  const cfg = {
    ...getExecutionConfig(),
    ...(options.config || {}),
  };

  const reasons = [];

  if (!route || typeof route !== "object") {
    return { ok: false, reasons: ["MISSING_ROUTE"], checks: {} };
  }

  const legs = Array.isArray(route.legs) ? route.legs : [];
  const metadata = route.metadata || {};
  const deadline = Number(route.deadline || 0);
  const now = nowSec();

  if (!legs.length) reasons.push("NO_LEGS");
  if (legs.length > cfg.maxRouteLegs) reasons.push("TOO_MANY_LEGS");

  if (cfg.requirePropagatedSizing && metadata.sizingMode !== "propagated") {
    reasons.push("UNPROPAGATED_SIZE");
  }

  if (cfg.requireExactRequote && metadata.exactRequoted !== true) {
    reasons.push("NOT_EXACT_REQUOTED");
  }

  if (!deadline || deadline <= now) {
    reasons.push("STALE_DEADLINE");
  } else if (deadline - now < cfg.minDeadlineRemainingSec) {
    reasons.push("DEADLINE_TOO_CLOSE");
  }

  reasons.push(...validateLegContinuity(route));

  return {
    ok: reasons.length === 0,
    reasons,
    checks: {
      legCount: legs.length,
      sizingMode: metadata.sizingMode || null,
      exactRequoted: metadata.exactRequoted === true,
      deadline,
      now,
      deadlineRemainingSec: deadline ? deadline - now : null,
      config: cfg,
    },
  };
}

module.exports = {
  shouldBuildExecution,
  getExecutionConfig,
};
