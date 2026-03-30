#!/usr/bin/env node
"use strict";

const { spawn } = require("child_process");
const path = require("path");

const refreshMs = Number(process.env.RPC_REFRESH_INTERVAL_MS || 600000);

function run(script) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script], { stdio: "inherit" });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

async function cycle() {
  const harvest = path.resolve(process.cwd(), "scripts/rpc/harvest-rpc-pool-v2.js");
  const alert = path.resolve(process.cwd(), "scripts/rpc/rpc-alert.js");
  const harvestCode = await run(harvest);
  await run(alert);
  console.log(`[rpc-health-daemon] cycle complete harvestCode=${harvestCode}`);
}

async function main() {
  await cycle();
  setInterval(cycle, refreshMs);
}

main().catch((err) => {
  console.error("[rpc-health-daemon] fatal:", err.message || err);
  process.exit(1);
});
