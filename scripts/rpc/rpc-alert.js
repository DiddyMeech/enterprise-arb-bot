#!/usr/bin/env node
"use strict";

require("dotenv").config();
const fs = require("fs");
const path = require("path");

const LANES_FILE = path.resolve(process.cwd(), "runtime/rpc/lanes.json");
const ALERTS_LOG = path.resolve(process.cwd(), "runtime/rpc/alerts.log");

function append(line) {
  fs.mkdirSync(path.dirname(ALERTS_LOG), { recursive: true });
  fs.appendFileSync(ALERTS_LOG, line + "\n", "utf8");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

async function sendWebhook(message) {
  const url = process.env.RPC_ALERT_WEBHOOK_URL;
  if (!url) return false;

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: message }),
  }).catch(() => null);

  return !!res && res.ok;
}

async function main() {
  if (!fs.existsSync(LANES_FILE)) {
    throw new Error(`Missing ${LANES_FILE}`);
  }

  const lanes = readJson(LANES_FILE);
  const low = lanes.lowInventory || {};
  const counts = lanes.healthCounts || {};

  if (!low.quote && !low.sim && !low.send) {
    console.log("RPC inventory healthy.");
    return;
  }

  const msg = [
    "[RPC ALERT] Healthy RPC inventory is low.",
    `quote=${counts.quote} low=${!!low.quote}`,
    `sim=${counts.sim} low=${!!low.sim}`,
    `send=${counts.send} low=${!!low.send}`,
    `generatedAt=${lanes.generatedAt}`,
  ].join(" | ");

  append(`${new Date().toISOString()} ${msg}`);

  const webhookOk = await sendWebhook(msg);
  console.log(webhookOk ? "Alert sent." : "Alert logged locally.");
}

main().catch((err) => {
  console.error("[rpc-alert] fatal:", err.message || err);
  process.exit(1);
});
