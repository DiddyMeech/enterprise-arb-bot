const { ethers } = require("ethers");
const config = require("@arb/config");
const { logger } = require("@arb/telemetry");

class MEVRelayer {
  constructor(relays = [], chainName = "arbitrum") {
    this.relays = relays;
    this.chainName = chainName;

    const chain = Object.values(config.CHAINS).find((c) => c.name === chainName);
    if (!chain?.rpcs?.length) {
      throw new Error(`No RPCs configured for ${chainName}`);
    }

    this.provider = new ethers.providers.JsonRpcProvider(chain.rpcs[0]);
    this.wallet = new ethers.Wallet(config.PRIVATE_KEY, this.provider);
    this.bloxrouteAuth = process.env.BLOXROUTE_AUTH_HEADER || "";
    this.flashbotsAuth = process.env.FLASHBOTS_KEY || "";
  }

  async broadcastBundle(signedTx) {
    if (config.SAFE_MODE) {
      logger.warn("[MEV] SAFE_MODE active; skipping broadcast");
      return {
        ok: true,
        status: "SIMULATED_SUCCESS",
        execId: `dry_run_exec_${Date.now()}`
      };
    }

    const results = [];
    let accepted = false;

    for (const relayUrl of this.relays) {
      try {
        const response = await fetch(relayUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(this.bloxrouteAuth ? { Authorization: this.bloxrouteAuth } : {}),
            ...(this.flashbotsAuth
              ? { "X-Flashbots-Signature": `${this.wallet.address}:${this.flashbotsAuth}` }
              : {})
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "eth_sendRawTransaction",
            params: [signedTx]
          })
        });

        const body = await response.text();
        results.push({ relayUrl, status: response.status, body });

        if (response.ok) {
          accepted = true;
          logger.info("[MEV] Relay accepted payload", { relayUrl, chain: this.chainName });
        } else {
          logger.warn("[MEV] Relay rejected payload", { relayUrl, status: response.status });
        }
      } catch (error) {
        results.push({ relayUrl, error: String(error) });
        logger.error("[MEV] Relay request failed", { relayUrl, error: String(error) });
      }
    }

    if (!accepted) {
      throw new Error("No relay accepted the transaction");
    }

    return {
      ok: true,
      status: "PENDING",
      execId: `live_exec_${Date.now()}`,
      relayResults: results
    };
  }
}

module.exports = MEVRelayer;
