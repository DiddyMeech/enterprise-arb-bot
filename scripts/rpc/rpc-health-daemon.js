#!/usr/bin/env node
"use strict";

const { spawn } = require("child_process");
const path = require("path");

const refreshMs = Number(process.env.RPC_REFRESH_INTERVAL_MS || 10 * 60 * 1000);

function runNode(script) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script], { stdio: "inherit" });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

async function cycle() {
  const harvest = path.resolve(process.cwd(), "scripts/rpc/harvest-rpc-pool.js");
  const alert = path.resolve(process.cwd(), "scripts/rpc/rpc-alert.js");

  const code = await runNode(harvest);
  await runNode(alert);

  console.log(`[rpc-health-daemon] cycle complete with code=${code}`);
}

async function main() {
  await cycle();
  setInterval(cycle, refreshMs);
}

main().catch((err) => {
  console.error("[rpc-health-daemon] fatal:", err.message || err);
  process.exit(1);
});
