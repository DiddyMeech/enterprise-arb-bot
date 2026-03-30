#!/usr/bin/env node
"use strict";

require("dotenv").config();
const fs = require("fs");
const path = require("path");

const CHAIN_ID_ARBITRUM = "0xa4b1";

const SOURCE_FILES = [
  "/home/meech/Desktop/enterprise-arb-bot/titan_auto_hunter/brain/loot_and_logs/Uncategorized/WEB3_RPC_NODES/VALID_HITS.md",
  "/home/meech/Desktop/enterprise-arb-bot/titan_auto_hunter/brain/loot_and_logs/Uncategorized/WEB3_DATA_APIS/VALID_HITS.md",
];

const OUT_DIR = path.resolve(process.cwd(), "runtime/rpc");
const CANDIDATES_FILE = path.join(OUT_DIR, "candidates.json");
const HEALTH_FILE = path.join(OUT_DIR, "health.json");
const LANES_FILE = path.join(OUT_DIR, "lanes.json");

const ENV_PATH = path.resolve(process.cwd(), ".env");

const QUOTE_TIMEOUT_MS = Number(process.env.RPC_TIMEOUT_MS_QUOTE || 2500);
const MIN_HEALTHY_QUOTE = Number(process.env.MIN_HEALTHY_QUOTE || 5);
const MIN_HEALTHY_SIM = Number(process.env.MIN_HEALTHY_SIM || 3);
const MIN_HEALTHY_SEND = Number(process.env.MIN_HEALTHY_SEND || 2);

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function safeRead(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function extractUrls(text) {
  const matches = text.match(/https?:\/\/[^\s<>"'`)\]]+/g) || [];
  return [...new Set(matches.map((x) => x.trim()))];
}

function looksRpcCandidate(url) {
  const u = url.toLowerCase();
  if (!u.startsWith("http")) return false;
  if (u.includes("wss://")) return false;
  return true;
}

function tagSource(url) {
  const u = url.toLowerCase();
  if (u.includes("alchemy")) return "alchemy";
  if (u.includes("infura")) return "infura";
  if (u.includes("ankr")) return "ankr";
  if (u.includes("quicknode")) return "quicknode";
  if (u.includes("blockpi")) return "blockpi";
  if (u.includes("drpc")) return "drpc";
  if (u.includes("blastapi")) return "blastapi";
  if (u.includes("llamarpc")) return "llamarpc";
  if (u.includes("nodereal")) return "nodereal";
  if (u.includes("chainstack")) return "chainstack";
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
      return { ok: false, elapsedMs, status: res.status, error: "Non-JSON response" };
    }

    if (!res.ok) {
      return { ok: false, elapsedMs, status: res.status, error: json?.error?.message || `HTTP ${res.status}` };
    }
    if (json.error) {
      return { ok: false, elapsedMs, status: res.status, error: json.error.message || "RPC error" };
    }

    return { ok: true, elapsedMs, status: res.status, result: json.result };
  } catch (err) {
    return {
      ok: false,
      elapsedMs: Date.now() - started,
      status: 0,
      error: err?.name === "AbortError" ? "Timeout" : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function scoreRpc(url, timeoutMs) {
  const meta = { url, provider: tagSource(url), checkedAt: new Date().toISOString() };

  const c = await rpcCall(url, "eth_chainId", [], timeoutMs);
  if (!c.ok) return { ...meta, ok: false, chainMatch: false, score: -1000, latencyMs: c.elapsedMs, reason: `eth_chainId failed: ${c.error}` };

  const chainMatch = String(c.result).toLowerCase() === CHAIN_ID_ARBITRUM;
  if (!chainMatch) return { ...meta, ok: false, chainMatch: false, score: -900, latencyMs: c.elapsedMs, reason: `wrong chain ${c.result}` };

  const b = await rpcCall(url, "eth_blockNumber", [], timeoutMs);
  if (!b.ok) return { ...meta, ok: false, chainMatch: true, score: -800, latencyMs: Math.max(c.elapsedMs, b.elapsedMs), reason: `eth_blockNumber failed: ${b.error}` };

  const gas = await rpcCall(url, "eth_gasPrice", [], timeoutMs);
  const latencyMs = Math.max(c.elapsedMs, b.elapsedMs, gas.elapsedMs || 0);

  let penalty = 0;
  if (latencyMs > 2000) penalty += 250;
  if (latencyMs > 3500) penalty += 500;
  if (!gas.ok) penalty += 100;

  return {
    ...meta,
    ok: true,
    chainMatch: true,
    score: 10000 - latencyMs - penalty,
    latencyMs,
    latestBlock: b.result,
    gasOk: gas.ok,
    reason: gas.ok ? "ok" : `gas failed: ${gas.error}`,
  };
}

function chooseLane(entry) {
  const p = entry.provider;
  const fast = entry.latencyMs <= 1500;

  if (["alchemy", "quicknode", "infura", "chainstack", "drpc"].includes(p) && fast) return ["quote", "sim", "send"];
  if (["ankr", "blockpi", "llamarpc", "arbitrum"].includes(p) && fast) return ["quote", "sim"];
  if (entry.latencyMs <= 2500) return ["quote"];
  return [];
}

function uniqueByUrl(items) {
  const seen = new Map();
  for (const item of items) {
    const prev = seen.get(item.url);
    if (!prev || (item.score || -999999) > (prev.score || -999999)) seen.set(item.url, item);
  }
  return [...seen.values()];
}

function sortBest(items) {
  return [...items].sort((a, b) => (b.score || 0) - (a.score || 0));
}

function upsertEnv(envPath, key, value) {
  let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  const line = `${key}=${value}`;
  const regex = new RegExp(`^${key}=.*$`, "m");
  if (regex.test(content)) {
    content = content.replace(regex, line);
  } else {
    if (!content.endsWith("\n") && content.length) content += "\n";
    content += line + "\n";
  }
  fs.writeFileSync(envPath, content, "utf8");
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

function buildLaneEnv(laneItems) {
  return laneItems.map((x) => x.url).join(",");
}

async function main() {
  ensureDir(OUT_DIR);

  const rawUrls = uniqueByUrl(
    SOURCE_FILES.flatMap((file) =>
      extractUrls(safeRead(file))
        .filter(looksRpcCandidate)
        .map((url) => ({ url, sourceFile: file }))
    )
  );

  if (!rawUrls.length) {
    throw new Error("No candidate URLs found in source files.");
  }

  const results = [];
  for (const item of rawUrls) {
    const scored = await scoreRpc(item.url, QUOTE_TIMEOUT_MS);
    results.push({ ...scored, sourceFile: item.sourceFile });
  }

  const healthy = results.filter((r) => r.ok);
  const quote = sortBest(healthy.filter((r) => chooseLane(r).includes("quote")));
  const sim = sortBest(healthy.filter((r) => chooseLane(r).includes("sim")));
  const send = sortBest(healthy.filter((r) => chooseLane(r).includes("send")));

  const lanes = {
    generatedAt: new Date().toISOString(),
    quote,
    sim,
    send,
    selected: {
      ARB_RPC_SCAN: quote[0]?.url || "",
      ARB_RPC_CONF: sim[0]?.url || quote[0]?.url || "",
      ARB_RPC_EXEC: send[0]?.url || sim[0]?.url || quote[0]?.url || "",
    },
    fallback: {
      ARBITRUM_QUOTE_RPC_URLS: buildLaneEnv(quote.slice(0, 15)),
      ARBITRUM_SIM_RPC_URLS: buildLaneEnv(sim.slice(0, 10)),
      ARBITRUM_SEND_RPC_URLS: buildLaneEnv(send.slice(0, 6)),
    },
    healthCounts: { quote: quote.length, sim: sim.length, send: send.length },
    lowInventory: {
      quote: quote.length < MIN_HEALTHY_QUOTE,
      sim: sim.length < MIN_HEALTHY_SIM,
      send: send.length < MIN_HEALTHY_SEND,
    },
  };

  writeJson(CANDIDATES_FILE, rawUrls);
  writeJson(HEALTH_FILE, results);
  writeJson(LANES_FILE, lanes);

  upsertEnv(ENV_PATH, "ARB_RPC_SCAN", lanes.selected.ARB_RPC_SCAN);
  upsertEnv(ENV_PATH, "ARB_RPC_CONF", lanes.selected.ARB_RPC_CONF);
  upsertEnv(ENV_PATH, "ARB_RPC_EXEC", lanes.selected.ARB_RPC_EXEC);
  upsertEnv(ENV_PATH, "ARBITRUM_QUOTE_RPC_URLS", lanes.fallback.ARBITRUM_QUOTE_RPC_URLS);
  upsertEnv(ENV_PATH, "ARBITRUM_SIM_RPC_URLS", lanes.fallback.ARBITRUM_SIM_RPC_URLS);
  upsertEnv(ENV_PATH, "ARBITRUM_SEND_RPC_URLS", lanes.fallback.ARBITRUM_SEND_RPC_URLS);

  console.log(JSON.stringify({
    ok: true,
    selected: lanes.selected,
    healthCounts: lanes.healthCounts,
    lowInventory: lanes.lowInventory,
    files: { candidates: CANDIDATES_FILE, health: HEALTH_FILE, lanes: LANES_FILE },
  }, null, 2));

  if (lanes.lowInventory.quote || lanes.lowInventory.sim || lanes.lowInventory.send) {
    process.exitCode = 20;
  }
}

main().catch((err) => {
  console.error("[harvest-rpc-pool] fatal:", err.message || err);
  process.exit(1);
});
