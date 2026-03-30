#!/usr/bin/env node
"use strict";

require("dotenv").config();
const { LANES_FILE, ALERTS_LOG, appendLog, readJson, nowIso } = require("./rpc-health-lib");

async function sendWebhook(message) {
  const url = process.env.RPC_ALERT_WEBHOOK_URL;
  if (!url) return false;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: message }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function main() {
  const lanes = readJson(LANES_FILE, null);
  if (!lanes) throw new Error("Missing lanes.json — run rpc:harvest first");

  const low = lanes.lowInventory || {};
  const counts = lanes.counts || {};

  if (!low.quote && !low.sim && !low.send) {
    console.log("RPC inventory healthy.");
    return;
  }

  const msg =
    `[RPC ALERT] low healthy inventory` +
    ` | quote=${counts.quote}` +
    ` | sim=${counts.sim}` +
    ` | send=${counts.send}` +
    ` | generatedAt=${lanes.generatedAt}`;

  appendLog(ALERTS_LOG, `${nowIso()} ${msg}`);

  const sent = await sendWebhook(msg);
  console.log(sent ? "Alert sent." : "Alert logged locally.");
}

main().catch((err) => {
  console.error("[rpc-alert] fatal:", err.message || err);
  process.exit(1);
});
