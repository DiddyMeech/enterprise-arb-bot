#!/usr/bin/env node
"use strict";

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const {
  HEALTH_FILE,
  LANES_FILE,
  appendLog,
  upsertEnv,
  loadState,
  saveState,
  updateEndpointState,
  isQuarantined,
  blockNumberHexToInt,
  endpointDerivedStats,
  writeJson,
  nowIso,
} = require("./rpc-health-lib");

const CHAIN_ID_ARBITRUM = "0xa4b1";

const SOURCE_FILES = [
  "/home/meech/Desktop/enterprise-arb-bot/titan_auto_hunter/brain/loot_and_logs/Uncategorized/WEB3_RPC_NODES/VALID_HITS.md",
  "/home/meech/Desktop/enterprise-arb-bot/titan_auto_hunter/brain/loot_and_logs/Uncategorized/WEB3_DATA_APIS/VALID_HITS.md",
];

const ENV_PATH = path.resolve(process.cwd(), ".env");

const QUOTE_TIMEOUT_MS = Number(process.env.RPC_TIMEOUT_MS_QUOTE || 2500);
const MIN_HEALTHY_QUOTE = Number(process.env.MIN_HEALTHY_QUOTE || 5);
const MIN_HEALTHY_SIM = Number(process.env.MIN_HEALTHY_SIM || 3);
const MIN_HEALTHY_SEND = Number(process.env.MIN_HEALTHY_SEND || 2);
const QUARANTINE_AFTER_FAILURES = Number(process.env.RPC_QUARANTINE_AFTER_FAILURES || 4);
const QUARANTINE_BASE_MS = Number(process.env.RPC_QUARANTINE_BASE_MS || 600000);
const MAX_BLOCK_LAG = Number(process.env.RPC_MAX_BLOCK_LAG || 4);

function safeRead(file) {
  try { return fs.readFileSync(file, "utf8"); } catch { return ""; }
}

function extractUrls(text) {
  return [...new Set((text.match(/https?:\/\/[^\s<>"'`)\]]+/g) || []).map((x) => x.trim()))];
}

function looksRpcCandidate(url) {
  return url.startsWith("http");
}

function providerTag(url) {
  const u = url.toLowerCase();
  if (u.includes("alchemy")) return "alchemy";
  if (u.includes("infura")) return "infura";
  if (u.includes("quicknode")) return "quicknode";
  if (u.includes("ankr")) return "ankr";
  if (u.includes("blockpi")) return "blockpi";
  if (u.includes("drpc")) return "drpc";
  if (u.includes("chainstack")) return "chainstack";
  if (u.includes("llamarpc")) return "llamarpc";
  if (u.includes("arbitrum")) return "arbitrum";
  return "unknown";
}

async function rpcCall(url, method, params = [], timeoutMs = 2500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: controller.signal,
    });
    const elapsedMs = Date.now() - started;
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch {
      return { ok: false, elapsedMs, error: "Non-JSON response", status: res.status };
    }
    if (!res.ok || json.error) {
      return { ok: false, elapsedMs, error: json?.error?.message || `HTTP ${res.status}`, status: res.status };
    }
    return { ok: true, elapsedMs, result: json.result, status: res.status };
  } catch (err) {
    return { ok: false, elapsedMs: Date.now() - started, error: err?.name === "AbortError" ? "Timeout" : String(err), status: 0 };
  } finally {
    clearTimeout(timer);
  }
}

async function probeEndpoint(url, timeoutMs) {
  const provider = providerTag(url);
  const chain = await rpcCall(url, "eth_chainId", [], timeoutMs);
  if (!chain.ok) return { url, provider, ok: false, latencyMs: chain.elapsedMs, reason: `chainId: ${chain.error}` };
  if (String(chain.result).toLowerCase() !== CHAIN_ID_ARBITRUM) {
    return { url, provider, ok: false, latencyMs: chain.elapsedMs, reason: `wrong chain ${chain.result}` };
  }
  const block = await rpcCall(url, "eth_blockNumber", [], timeoutMs);
  if (!block.ok) return { url, provider, ok: false, latencyMs: Math.max(chain.elapsedMs, block.elapsedMs), reason: `block: ${block.error}` };
  const gas = await rpcCall(url, "eth_gasPrice", [], timeoutMs);
  const latestBlockNumber = blockNumberHexToInt(block.result);
  const latencyMs = Math.max(chain.elapsedMs, block.elapsedMs, gas.elapsedMs || 0);
  return { url, provider, ok: true, latencyMs, latestBlockNumber, gasOk: gas.ok, reason: gas.ok ? "ok" : `gas: ${gas.error}` };
}

function getReferenceBlock(healthyResults) {
  const blocks = healthyResults.map((r) => r.latestBlockNumber).filter((n) => Number.isFinite(n));
  return blocks.length ? Math.max(...blocks) : null;
}

function scoreEndpoint(result, stateStats, referenceBlock) {
  if (!result.ok) return -10000;
  let score = 10000;
  score -= result.latencyMs;
  if (!result.gasOk) score -= 75;
  if (stateStats?.medianLatencyMs) score -= Math.round(stateStats.medianLatencyMs * 0.2);
  if (typeof stateStats?.successRate === "number") score += Math.round(stateStats.successRate * 500);
  if (referenceBlock && Number.isFinite(result.latestBlockNumber)) {
    const lag = Math.max(0, referenceBlock - result.latestBlockNumber);
    score -= lag * 250;
  }
  if (stateStats?.quarantined) score -= 2000;
  return score;
}

function chooseLane(result, stateStats, referenceBlock) {
  if (!result.ok) return [];
  const lag = referenceBlock && Number.isFinite(result.latestBlockNumber)
    ? Math.max(0, referenceBlock - result.latestBlockNumber) : 0;
  const medianLatency = stateStats?.medianLatencyMs ?? result.latencyMs;
  const successRate = stateStats?.successRate ?? 1;
  const strongProvider = ["alchemy", "quicknode", "infura", "chainstack", "drpc"].includes(result.provider);
  if (lag <= 1 && medianLatency <= 1200 && successRate >= 0.8 && strongProvider) return ["quote", "sim", "send"];
  if (lag <= 2 && medianLatency <= 1800 && successRate >= 0.7) return ["quote", "sim"];
  if (lag <= MAX_BLOCK_LAG && medianLatency <= 2600 && successRate >= 0.5) return ["quote"];
  return [];
}

function serializeLane(list, limit) {
  return list.slice(0, limit).map((x) => x.url).join(",");
}

const CONCURRENCY = Number(process.env.RPC_PROBE_CONCURRENCY || 30);

async function main() {
  const state = loadState();

  const urls = [...new Set(
    SOURCE_FILES.flatMap((file) => extractUrls(safeRead(file)).filter(looksRpcCandidate))
  )];

  if (!urls.length) throw new Error("No candidate RPC URLs found in source files.");

  const toProbe = urls.filter((url) => {
    const st = state.endpoints[url];
    return !st?.disabled && !(st && isQuarantined(st));
  });

  console.error(`[rpc-harvest] probing ${toProbe.length}/${urls.length} candidates (concurrency=${CONCURRENCY})...`);

  const rawResults = [];
  let done = 0;
  let i = 0;

  async function worker() {
    while (i < toProbe.length) {
      const url = toProbe[i++];
      const result = await probeEndpoint(url, QUOTE_TIMEOUT_MS);
      updateEndpointState(state, result, {
        quarantineAfterFailures: QUARANTINE_AFTER_FAILURES,
        baseCooldownMs: QUARANTINE_BASE_MS,
      });
      rawResults.push(result);
      done++;
      if (done % 100 === 0) {
        console.error(`[rpc-harvest] ${done}/${toProbe.length} probed, ${rawResults.filter(r => r.ok).length} healthy so far...`);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, toProbe.length) }, worker));
  console.error(`[rpc-harvest] done. ${rawResults.filter(r => r.ok).length} healthy out of ${rawResults.length} probed.`);

  const healthy = rawResults.filter((r) => r.ok);
  const referenceBlock = getReferenceBlock(healthy);

  const enriched = rawResults.map((r) => {
    const stats = endpointDerivedStats(state.endpoints[r.url] || {});
    const lag = referenceBlock && Number.isFinite(r.latestBlockNumber)
      ? Math.max(0, referenceBlock - r.latestBlockNumber) : null;
    return {
      ...r,
      successRate: stats.successRate,
      medianLatencyMs: stats.medianLatencyMs,
      quarantined: stats.quarantined,
      lagBlocks: lag,
      score: scoreEndpoint(r, stats, referenceBlock),
    };
  });

  const quote = enriched.filter((r) => chooseLane(r, r, referenceBlock).includes("quote")).sort((a, b) => b.score - a.score);
  const sim = enriched.filter((r) => chooseLane(r, r, referenceBlock).includes("sim")).sort((a, b) => b.score - a.score);
  const send = enriched.filter((r) => chooseLane(r, r, referenceBlock).includes("send")).sort((a, b) => b.score - a.score);

  const lanes = {
    generatedAt: nowIso(),
    referenceBlock,
    counts: {
      totalCandidates: urls.length,
      checked: rawResults.length,
      healthy: healthy.length,
      quote: quote.length,
      sim: sim.length,
      send: send.length,
    },
    selected: {
      ARB_RPC_SCAN: quote[0]?.url || "",
      ARB_RPC_CONF: sim[0]?.url || quote[0]?.url || "",
      ARB_RPC_EXEC: send[0]?.url || sim[0]?.url || quote[0]?.url || "",
    },
    fallback: {
      ARBITRUM_QUOTE_RPC_URLS: serializeLane(quote, 15),
      ARBITRUM_SIM_RPC_URLS: serializeLane(sim, 10),
      ARBITRUM_SEND_RPC_URLS: serializeLane(send, 6),
    },
    lowInventory: {
      quote: quote.length < MIN_HEALTHY_QUOTE,
      sim: sim.length < MIN_HEALTHY_SIM,
      send: send.length < MIN_HEALTHY_SEND,
    },
    topQuote: quote.slice(0, 10),
    topSim: sim.slice(0, 10),
    topSend: send.slice(0, 10),
  };

  writeJson(HEALTH_FILE, enriched);
  writeJson(LANES_FILE, lanes);
  saveState(state);

  upsertEnv(ENV_PATH, "ARB_RPC_SCAN", lanes.selected.ARB_RPC_SCAN);
  upsertEnv(ENV_PATH, "ARB_RPC_CONF", lanes.selected.ARB_RPC_CONF);
  upsertEnv(ENV_PATH, "ARB_RPC_EXEC", lanes.selected.ARB_RPC_EXEC);
  upsertEnv(ENV_PATH, "ARBITRUM_QUOTE_RPC_URLS", lanes.fallback.ARBITRUM_QUOTE_RPC_URLS);
  upsertEnv(ENV_PATH, "ARBITRUM_SIM_RPC_URLS", lanes.fallback.ARBITRUM_SIM_RPC_URLS);
  upsertEnv(ENV_PATH, "ARBITRUM_SEND_RPC_URLS", lanes.fallback.ARBITRUM_SEND_RPC_URLS);

  appendLog(
    path.resolve(process.cwd(), "runtime/rpc/alerts.log"),
    `${nowIso()} [rpc-harvest-v2] quote=${quote.length} sim=${sim.length} send=${send.length}`
  );

  console.log(JSON.stringify({
    ok: true,
    selected: lanes.selected,
    counts: lanes.counts,
    lowInventory: lanes.lowInventory,
    referenceBlock: lanes.referenceBlock,
  }, null, 2));

  if (lanes.lowInventory.quote || lanes.lowInventory.sim || lanes.lowInventory.send) {
    process.exitCode = 20;
  }
}

main().catch((err) => {
  console.error("[harvest-rpc-pool-v2] fatal:", err.message || err);
  process.exit(1);
});
