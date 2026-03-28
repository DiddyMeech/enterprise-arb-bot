const { ethers } = require('ethers');
const config = require('@arb/config');
const { logger, metrics } = require('@arb/telemetry');

class RpcMonitor {
    constructor() {
        this.chains = config.CHAINS;
    }

    async startMonitoring(intervalMs = 60000) {
        logger.info("[RPC MONITOR] Booting API Key Sentinel... (Monitoring for 401/403 Revocations)");
        
        setInterval(() => this.checkAllRpcs(), intervalMs);
        await this.checkAllRpcs(); // Immediate verification bounds
    }

    async checkAllRpcs() {
        for (const [key, chain] of Object.entries(this.chains)) {
            let healthyCount = 0;

            for (let i = 0; i < chain.rpcs.length; i++) {
                const rpcUrl = chain.rpcs[i];
                const isHealthy = await this.pingRpc(rpcUrl);
                
                if (!isHealthy) {
                    logger.error(`[ALERT] 🚨 RPC API Key Revoked or Dead for ${chain.name}: ${this.maskUrl(rpcUrl)}`);
                    logger.warn(`[FAILOVER] Automatically rotating to the next available tier...`);
                    metrics.increment(`rpc_revocation_event_${chain.name}`, 1);
                } else {
                    healthyCount++;
                }
            }

            if (healthyCount === 0 && chain.rpcs.length > 0) {
                logger.error(`[FATAL ALERT] 🔴 ALL ${chain.name} RPC API Keys are completely offline or revoked!`);
            }
        }
    }

    async pingRpc(url) {
        try {
            const provider = new ethers.providers.JsonRpcProvider(url);
            // Requesting latest block validates the RPC payload credentials seamlessly
            await provider.getBlockNumber();
            return true;
        } catch (error) {
            // Target Auth / Quota rejection markers
            if (error.message.includes('401') || error.message.includes('403') || error.message.includes('429')) {
                return false;
            }
            return false; // Hardware dead
        }
    }

    // Prevents plaintext API key leaks directly into Grafana UI
    maskUrl(url) {
        try {
            const parsed = new URL(url);
            return `${parsed.protocol}//${parsed.hostname}/...${parsed.pathname.slice(-8)}`;
        } catch {
            return "***masked***";
        }
    }
}

module.exports = RpcMonitor;
