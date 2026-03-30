"use strict";

const fs = require("fs");
const path = require("path");

const RUNTIME_DIR = path.resolve(process.cwd(), "runtime/rpc");
const STATE_FILE = path.join(RUNTIME_DIR, "state.json");
const HEALTH_FILE = path.join(RUNTIME_DIR, "health.json");
const LANES_FILE = path.join(RUNTIME_DIR, "lanes.json");
const ALERTS_LOG = path.join(RUNTIME_DIR, "alerts.log");

function ensureDir() {
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
}

function readJson(file, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  ensureDir();
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

function appendLog(file, line) {
  ensureDir();
  fs.appendFileSync(file, line + "\n", "utf8");
}

function upsertEnv(envPath, key, value) {
  let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  const line = `${key}=${value}`;
  const regex = new RegExp(`^${key}=.*$`, "m");
  if (regex.test(content)) {
    content = content.replace(regex, line);
  } else {
    if (content.length && !content.endsWith("\n")) content += "\n";
    content += line + "\n";
  }
  fs.writeFileSync(envPath, content, "utf8");
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function nowIso() {
  return new Date().toISOString();
}

function loadState() {
  return readJson(STATE_FILE, {
    version: 2,
    endpoints: {},
    lastRebalancedAt: null,
  });
}

function saveState(state) {
  writeJson(STATE_FILE, state);
}

function getEndpointState(state, url) {
  if (!state.endpoints[url]) {
    state.endpoints[url] = {
      url,
      provider: "unknown",
      firstSeenAt: nowIso(),
      lastSeenAt: null,
      lastCheckedAt: null,
      lastSuccessAt: null,
      lastFailureAt: null,
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
      totalChecks: 0,
      totalSuccesses: 0,
      totalFailures: 0,
      latencyHistoryMs: [],
      recentBlockNumbers: [],
      quarantinedUntil: null,
      quarantineCount: 0,
      lastReason: null,
      disabled: false,
    };
  }
  return state.endpoints[url];
}

function pushBounded(arr, value, max = 20) {
  arr.push(value);
  while (arr.length > max) arr.shift();
}

function updateEndpointState(state, result, opts = {}) {
  const s = getEndpointState(state, result.url);
  s.provider = result.provider || s.provider || "unknown";
  s.lastSeenAt = nowIso();
  s.lastCheckedAt = nowIso();
  s.totalChecks += 1;
  s.lastReason = result.reason || null;

  if (typeof result.latestBlockNumber === "number") {
    pushBounded(s.recentBlockNumbers, result.latestBlockNumber, 15);
  }
  if (typeof result.latencyMs === "number") {
    pushBounded(s.latencyHistoryMs, result.latencyMs, 20);
  }

  if (result.ok) {
    s.totalSuccesses += 1;
    s.consecutiveSuccesses += 1;
    s.consecutiveFailures = 0;
    s.lastSuccessAt = nowIso();
  } else {
    s.totalFailures += 1;
    s.consecutiveFailures += 1;
    s.consecutiveSuccesses = 0;
    s.lastFailureAt = nowIso();
  }

  const quarantineAfterFailures = Number(opts.quarantineAfterFailures || 4);
  const baseCooldownMs = Number(opts.baseCooldownMs || 10 * 60 * 1000);

  if (!result.ok && s.consecutiveFailures >= quarantineAfterFailures) {
    const cooldownMs = baseCooldownMs * Math.min(6, Math.max(1, s.quarantineCount + 1));
    s.quarantinedUntil = new Date(Date.now() + cooldownMs).toISOString();
    s.quarantineCount += 1;
  }

  if (result.ok && s.quarantinedUntil) {
    s.quarantinedUntil = null;
  }

  return s;
}

function isQuarantined(endpointState) {
  if (!endpointState?.quarantinedUntil) return false;
  return Date.now() < new Date(endpointState.quarantinedUntil).getTime();
}

function blockNumberHexToInt(v) {
  if (typeof v !== "string") return null;
  try {
    return parseInt(v, 16);
  } catch {
    return null;
  }
}

function endpointDerivedStats(endpointState) {
  const total = endpointState.totalChecks || 0;
  const successRate = total ? endpointState.totalSuccesses / total : 0;
  const medianLatencyMs = median(endpointState.latencyHistoryMs || []) || null;
  const latestSeenBlock = (() => {
    const vals = (endpointState.recentBlockNumbers || []).filter((n) => Number.isFinite(n));
    return vals.length ? Math.max(...vals) : null;
  })();

  return {
    successRate,
    medianLatencyMs,
    latestSeenBlock,
    quarantined: isQuarantined(endpointState),
  };
}

module.exports = {
  RUNTIME_DIR,
  STATE_FILE,
  HEALTH_FILE,
  LANES_FILE,
  ALERTS_LOG,
  ensureDir,
  readJson,
  writeJson,
  appendLog,
  upsertEnv,
  loadState,
  saveState,
  getEndpointState,
  updateEndpointState,
  isQuarantined,
  blockNumberHexToInt,
  endpointDerivedStats,
  nowIso,
};
