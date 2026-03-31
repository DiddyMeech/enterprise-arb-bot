const fs = require("fs");
const path = require("path");

function nowIso() {
  return new Date().toISOString();
}

function envBool(name, fallback = false) {
  const v = process.env[name];
  if (v == null || v === "") return fallback;
  return String(v).toLowerCase() === "true";
}

function envNum(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) ? n : fallback;
}

function getTradingMode() {
  return String(process.env.TRADING_MODE || "dryrun").toLowerCase();
}

function getPaperLogFile() {
  return path.resolve(process.cwd(), process.env.PAPER_LOG_FILE || "runtime/paper-trades.jsonl");
}

function getLiveLogFile() {
  return path.resolve(process.cwd(), process.env.LIVE_LOG_FILE || "runtime/live-trades.jsonl");
}

function appendJsonl(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(obj) + "\n", "utf8");
}

function getAllowlist() {
  return String(process.env.LIVE_ROUTE_ALLOWLIST || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function isRouteAllowlisted(route) {
  const enabled = envBool("LIVE_ROUTE_ALLOWLIST_ENABLED", false);
  if (!enabled) return true;
  const allow = getAllowlist();
  return allow.includes(route?.id);
}

function shouldPermitLive(route) {
  const reasons = [];
  const mode = getTradingMode();

  if (mode !== "live") reasons.push("MODE_NOT_LIVE");
  if (!envBool("LIVE_TRADING_ENABLED", false)) reasons.push("LIVE_DISABLED");

  const requireManualArm = envBool("REQUIRE_MANUAL_ARM", true);
  const armToken = String(process.env.MANUAL_ARM_TOKEN || "");
  if (requireManualArm && !armToken) reasons.push("MANUAL_ARM_MISSING");

  const maxLiveNotionalUsd = envNum("MAX_LIVE_NOTIONAL_USD", 10);
  const routeNotional = Number(route?.metadata?.amountInUsd || route?.amountInUsd || 0);
  if (routeNotional > maxLiveNotionalUsd) reasons.push("LIVE_NOTIONAL_TOO_HIGH");

  if (!isRouteAllowlisted(route)) reasons.push("ROUTE_NOT_ALLOWLISTED");

  return {
    ok: reasons.length === 0,
    reasons,
    checks: {
      mode,
      liveEnabled: envBool("LIVE_TRADING_ENABLED", false),
      requireManualArm,
      hasManualArmToken: !!armToken,
      maxLiveNotionalUsd,
      routeNotional,
    },
  };
}

function recordPaperTrade(route, extra = {}) {
  appendJsonl(getPaperLogFile(), {
    ts: nowIso(),
    type: "paper",
    routeId: route?.id || null,
    netProfitUsd: route?.netProfitUsd ?? null,
    grossProfitUsd: route?.grossProfitUsd ?? null,
    metadata: route?.metadata || {},
    extra,
  });
}

function recordLiveTrade(route, extra = {}) {
  appendJsonl(getLiveLogFile(), {
    ts: nowIso(),
    type: "live",
    routeId: route?.id || null,
    netProfitUsd: route?.netProfitUsd ?? null,
    grossProfitUsd: route?.grossProfitUsd ?? null,
    metadata: route?.metadata || {},
    extra,
  });
}

function recordPaperCandidate(route, extra = {}) {
  appendJsonl(getPaperLogFile(), {
    ts: nowIso(),
    type: "paper-candidate",
    routeId: route?.id || null,
    score: route?.ranking?.score ?? null,
    netProfitUsd: route?.netProfitUsd ?? null,
    grossProfitUsd: route?.grossProfitUsd ?? null,
    gasUsd: route?.gasUsd ?? null,
    ranking: route?.ranking || null,
    metadata: route?.metadata || {},
    extra,
  });
}

function recordPaperSummary(summary, extra = {}) {
  appendJsonl(getPaperLogFile(), {
    ts: nowIso(),
    type: "paper-summary",
    summary,
    extra,
  });
}

function recordWouldSend(route, extra = {}) {
  appendJsonl(getPaperLogFile(), {
    ts: nowIso(),
    type: "would-send",
    routeId: route?.id || null,
    netProfitUsd: route?.netProfitUsd ?? null,
    grossProfitUsd: route?.grossProfitUsd ?? null,
    metadata: route?.metadata || {},
    ranking: route?.ranking || null,
    extra,
  });
}

function recordFamilyAnalytics(summary, extra = {}) {
  appendJsonl(getPaperLogFile(), {
    ts: nowIso(),
    type: "family-analytics",
    summary,
    extra,
  });
}

module.exports = {
  getTradingMode,
  shouldPermitLive,
  recordPaperTrade,
  recordLiveTrade,
  recordPaperCandidate,
  recordPaperSummary,
  recordWouldSend,
  recordFamilyAnalytics,
};
