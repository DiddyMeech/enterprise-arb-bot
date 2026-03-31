const familyFailures = new Map();

function nowMs() {
  return Date.now();
}

function envNum(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) ? n : fallback;
}

function getRouteFamilyKey(route) {
  const legs = Array.isArray(route?.legs) ? route.legs : [];
  const dexPath = legs.map((l) => String(l?.dex || "").toLowerCase()).join("->");
  const tokenPath = legs
    .map((l, i) =>
      i === 0
        ? `${String(l?.tokenIn || "").toLowerCase()}->${String(l?.tokenOut || "").toLowerCase()}`
        : String(l?.tokenOut || "").toLowerCase()
    )
    .join("->");

  return [
    route?.shape || "unknown",
    route?.tokenInSymbol || "unknown",
    route?.tokenOutSymbol || "unknown",
    dexPath,
    tokenPath,
  ].join("|");
}

function familyCooldownMs() {
  return envNum("ROUTE_FAMILY_FAILURE_COOLDOWN_MS", 60000);
}

function familyFailureThreshold() {
  return envNum("MAX_FAMILY_FAILURES_BEFORE_COOLDOWN", 3);
}

function markFamilyFailure(route) {
  const key = getRouteFamilyKey(route);
  const item = familyFailures.get(key) || { count: 0, lastFailureAt: 0 };
  item.count += 1;
  item.lastFailureAt = nowMs();
  familyFailures.set(key, item);
}

function clearFamilyFailure(route) {
  familyFailures.delete(getRouteFamilyKey(route));
}

function isFamilyCoolingDown(route) {
  const key = getRouteFamilyKey(route);
  const item = familyFailures.get(key);
  if (!item) return false;
  if (item.count < familyFailureThreshold()) return false;
  return nowMs() - item.lastFailureAt < familyCooldownMs();
}

function getFamilyFailureState(route) {
  const key = getRouteFamilyKey(route);
  const item = familyFailures.get(key) || { count: 0, lastFailureAt: 0 };
  return {
    key,
    count: item.count,
    lastFailureAt: item.lastFailureAt,
    coolingDown: isFamilyCoolingDown(route),
  };
}

module.exports = {
  getRouteFamilyKey,
  markFamilyFailure,
  clearFamilyFailure,
  isFamilyCoolingDown,
  getFamilyFailureState,
};
