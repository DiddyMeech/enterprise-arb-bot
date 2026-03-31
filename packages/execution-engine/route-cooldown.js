const failures = new Map();

function nowMs() {
  return Date.now();
}

function cooldownMs() {
  const n = Number(process.env.ROUTE_FAILURE_COOLDOWN_MS || 30000);
  return Number.isFinite(n) ? n : 30000;
}

function getRouteCooldownKey(route) {
  return route?.id || "unknown-route";
}

function isRouteCoolingDown(route) {
  const key = getRouteCooldownKey(route);
  const ts = failures.get(key);
  if (!ts) return false;
  return nowMs() - ts < cooldownMs();
}

function markRouteFailure(route) {
  failures.set(getRouteCooldownKey(route), nowMs());
}

function clearRouteFailure(route) {
  failures.delete(getRouteCooldownKey(route));
}

module.exports = {
  isRouteCoolingDown,
  markRouteFailure,
  clearRouteFailure,
  getRouteCooldownKey,
};
