const { ethers } = require("ethers");

function envBool(name, fallback = false) {
  const v = process.env[name];
  if (v == null || v === "") return fallback;
  return String(v).toLowerCase() === "true";
}

function envNum(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) ? n : fallback;
}

function getSendConfig() {
  return {
    sendTransactions: envBool("SEND_TRANSACTIONS", false),
    liveTradingEnabled: envBool("LIVE_TRADING_ENABLED", false),
    tradingMode: String(process.env.TRADING_MODE || "dryrun").toLowerCase(),
    maxSendGasLimit: envNum("MAX_SEND_GAS_LIMIT", 450000),
    txDeadlineSafetySec: envNum("TX_DEADLINE_SAFETY_SEC", 5),
  };
}

function shouldBroadcastTx(route) {
  const cfg = getSendConfig();
  const reasons = [];

  if (cfg.tradingMode !== "live") reasons.push("MODE_NOT_LIVE");
  if (!cfg.liveTradingEnabled) reasons.push("LIVE_DISABLED");
  if (!cfg.sendTransactions) reasons.push("SEND_TRANSACTIONS_DISABLED");

  const now = Math.floor(Date.now() / 1000);
  const deadline = Number(route?.deadline || 0);
  if (!deadline || deadline <= now) reasons.push("STALE_DEADLINE");
  if (deadline && deadline - now < cfg.txDeadlineSafetySec) {
    reasons.push("DEADLINE_TOO_CLOSE_TO_SEND");
  }

  return {
    ok: reasons.length === 0,
    reasons,
    checks: cfg,
  };
}

async function buildUnsignedTx({
  signer,
  executionPlan,
}) {
  const provider = signer.provider;
  if (!provider) {
    throw new Error("SIGNER_HAS_NO_PROVIDER");
  }

  const from = await signer.getAddress();
  const feeData = await provider.getFeeData();

  const tx = {
    from,
    to: executionPlan.target,
    data: executionPlan.calldata,
    value: executionPlan.value ? ethers.BigNumber.from(executionPlan.value).toHexString() : "0x0",
  };

  const gasEstimate = await provider.estimateGas(tx);
  tx.gasLimit = gasEstimate.mul(12).div(10); // 20% headroom

  if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
    tx.maxFeePerGas = feeData.maxFeePerGas;
    tx.maxPriorityFeePerGas = feeData.maxPriorityFeePerGas;
  } else if (feeData.gasPrice) {
    tx.gasPrice = feeData.gasPrice;
  }

  return tx;
}

async function simulateUnsignedTx(provider, tx) {
  return provider.call({
    to: tx.to,
    data: tx.data,
    value: tx.value || "0x0",
  });
}

async function broadcastSignedTx(signer, tx) {
  return signer.sendTransaction(tx);
}

module.exports = {
  getSendConfig,
  shouldBroadcastTx,
  buildUnsignedTx,
  simulateUnsignedTx,
  broadcastSignedTx,
};
