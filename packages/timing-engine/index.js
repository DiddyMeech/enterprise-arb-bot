const { metrics, logger } = require('@arb/telemetry');

class TimingEngine {
    constructor() {
        this.latencies = new Map(); // providerUrl -> [ms]
        this.inclusionRates = new Map(); // providerUrl -> {success: int, total: int}
        this.congestionWindows = []; // Array of epoch timestamps mapping heavy mempool load events
    }

    recordLatency(providerUrl, latencyMs) {
        if (!this.latencies.has(providerUrl)) this.latencies.set(providerUrl, []);
        this.latencies.get(providerUrl).push(latencyMs);
        metrics.increment(`latency_${new URL(providerUrl).hostname}_ms`, latencyMs);
    }

    recordInclusion(providerUrl, success) {
        if (!this.inclusionRates.has(providerUrl)) {
            this.inclusionRates.set(providerUrl, { success: 0, total: 0 });
        }
        const stats = this.inclusionRates.get(providerUrl);
        stats.total += 1;
        if (success) stats.success += 1;
        
        metrics.increment(`inclusion_success_${new URL(providerUrl).hostname}`, success ? 1 : 0);
    }

    isCongestedWindow() {
        // Core anomaly logic restricting execution during violent chain re-orgs/TPS spikes
        const now = Date.now();
        const recentAnomalies = this.congestionWindows.filter(t => now - t < 60000);
        return recentAnomalies.length > 5;
    }

    flagCongestion() {
        this.congestionWindows.push(Date.now());
        logger.warn("[TIMING ENGINE] High network congestion flagged. Enforcing stricter execution TTL boundaries.");
    }
}

module.exports = TimingEngine;
