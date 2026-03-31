const fs = require("fs");
const path = require("path");

function envNum(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) ? n : fallback;
}

function getLiveLogFile() {
  return path.resolve(process.cwd(), process.env.LIVE_LOG_FILE || "runtime/live-trades.jsonl");
}

function todayPrefix() {
  return new Date().toISOString().slice(0, 10);
}

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    })
    .filter(Boolean);
}

function checkLiveLimits() {
  const entries = readJsonl(getLiveLogFile()).filter((e) =>
    String(e.ts || "").startsWith(todayPrefix())
  );

  const maxDailyLoss = envNum("MAX_DAILY_LIVE_LOSS_USD", 5);
  const maxConsecutiveFailures = envNum("MAX_CONSECUTIVE_LIVE_FAILURES", 3);

  let pnl = 0;
  let consecutiveFailures = 0;

  for (const e of entries) {
    pnl += Number(e.netProfitUsd || 0);
    if (String(e.extra?.status || "").includes("FAIL")) {
      consecutiveFailures += 1;
    } else {
      consecutiveFailures = 0;
    }
  }

  const reasons = [];
  if (pnl <= -Math.abs(maxDailyLoss)) reasons.push("DAILY_LOSS_LIMIT_HIT");
  if (consecutiveFailures >= maxConsecutiveFailures) reasons.push("CONSECUTIVE_FAILURE_LIMIT_HIT");

  return {
    ok: reasons.length === 0,
    reasons,
    checks: {
      pnl,
      consecutiveFailures,
      maxDailyLoss,
      maxConsecutiveFailures,
    },
  };
}

module.exports = {
  checkLiveLimits,
};
