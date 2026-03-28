const { Pool } = require('pg');
const config = require('@arb/config');
const { logger } = require('@arb/telemetry');

class LearningEngine {
    constructor() {
        this.pool = new Pool({
            connectionString: config.DATABASE_URL,
            max: 20, // Strict concurrent persistence bounds
            idleTimeoutMillis: 30000
        });

        this.pool.on('error', (err) => {
            logger.error(`[LEARNING-ENGINE] Critical PostgreSQL persistence fault: ${err.message}`);
        });
    }

    /**
     * Store 13-stage decision outputs into Timescale persistence arrays.
     */
    async recordDecision(opp, decision, score) {
        const query = `
            INSERT INTO decisions (opportunity_id, chain, route_signature, status, reason, config_version, route_score)
            VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id;
        `;
        try {
            const res = await this.pool.query(query, [
                opp.id, opp.chain, opp.routeSignature, decision.status, decision.reason, config.POLICY.version, score
            ]);
            return res.rows[0].id;
        } catch (e) {
            logger.warn(`[LEARNING-ENGINE] Decision telemetry drop: ${e.message}`);
            return null;
        }
    }

    async recordSimulation(decisionId, opp, sim) {
        const query = `
            INSERT INTO simulations (decision_id, chain, route_signature, expected_gross_profit_usd, expected_net_profit_usd, status, revert_reason)
            VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id;
        `;
        try {
            const res = await this.pool.query(query, [
                decisionId, opp.chain, opp.routeSignature, sim.expectedGrossUsd, sim.expectedNetUsd, sim.status, sim.revertReason
            ]);
            return res.rows[0].id;
        } catch (e) {
            logger.warn(`[LEARNING-ENGINE] Simulation telemetry drop: ${e.message}`);
            return null;
        }
    }

    async recordExecutionResult(execId, opp, actuals) {
        const query = `
            INSERT INTO execution_results 
            (execution_id, chain, route_signature, actual_net_profit_usd, actual_gas_paid_usd, realized_slippage_bps, latency_to_inclusion_ms, quote_to_fill_drift_bps, status, revert_reason)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10);
        `;
        try {
            await this.pool.query(query, [
                execId, opp.chain, opp.routeSignature, actuals.netProfitUsd, actuals.gasPaidUsd, 
                actuals.realizedSlippageBps, actuals.latencyMs, actuals.quoteDriftBps, actuals.status, actuals.revertReason
            ]);
            
            await this.updateRouteMetrics(opp.routeSignature, opp.chain, opp.dexCombo, actuals);

            // CIRCUIT BREAKER LOGIC: Evaluate if strict consecutive failure limits have been breached
            if (actuals.status !== 'WIN') {
                const history = await this.pool.query(
                    `SELECT status FROM execution_results WHERE chain = $1 ORDER BY timestamp DESC LIMIT $2`, 
                    [opp.chain, config.POLICY.chains[opp.chain.toLowerCase()].consecutive_fail_pause_count]
                );
                
                const consecutiveFails = history.rows.filter(r => r.status !== 'WIN').length;
                if (history.rows.length > 0 && consecutiveFails === history.rows.length) {
                    logger.warn(`[CIRCUIT-BREAKER] 🛑 High Anomaly Faults! ${consecutiveFails} sequential failures on ${opp.chain}. Engaging Global Pause Array.`);
                    await this.pool.query(
                        `INSERT INTO pause_events (chain, scope, trigger_reason, circuit_breaker_type) VALUES ($1, 'CHAIN', 'Consecutive Live Failures anomaly mapped', 'CONSECUTIVE_REVERTS')`,
                        [opp.chain]
                    );
                }
            }

        } catch (e) {
            logger.warn(`[LEARNING-ENGINE] Execution Result telemetry drop: ${e.message}`);
        }
    }

    async updateRouteMetrics(routeSignature, chain, dexCombo, actuals) {
        const isWin = actuals.status === 'WIN';
        const isRevert = ['REVERTED', 'LOSS'].includes(actuals.status);
        
        const q = `
            INSERT INTO route_metrics (route_signature, chain, dex_combo, total_trades, avg_net_profit_usd, avg_quote_drift_bps)
            VALUES ($1, $2, $3, 1, $4, $5)
            ON CONFLICT (route_signature) DO UPDATE SET
                total_trades = route_metrics.total_trades + 1,
                avg_net_profit_usd = ((route_metrics.avg_net_profit_usd * route_metrics.total_trades) + EXCLUDED.avg_net_profit_usd) / (route_metrics.total_trades + 1),
                avg_quote_drift_bps = ((route_metrics.avg_quote_drift_bps * route_metrics.total_trades) + EXCLUDED.avg_quote_drift_bps) / (route_metrics.total_trades + 1),
                win_rate = CASE WHEN $6 THEN ((route_metrics.win_rate * route_metrics.total_trades) + 1.0) / (route_metrics.total_trades + 1) ELSE (route_metrics.win_rate * route_metrics.total_trades) / (route_metrics.total_trades + 1) END,
                revert_rate = CASE WHEN $7 THEN ((route_metrics.revert_rate * route_metrics.total_trades) + 1.0) / (route_metrics.total_trades + 1) ELSE (route_metrics.revert_rate * route_metrics.total_trades) / (route_metrics.total_trades + 1) END,
                last_updated = CURRENT_TIMESTAMP;
        `;
        try {
            await this.pool.query(q, [routeSignature, chain, dexCombo, actuals.netProfitUsd, actuals.quoteDriftBps, isWin, isRevert]);
        } catch (e) {
            logger.error(`[LEARNING-ENGINE] Route metric algorithmic failure: ${e.message}`);
        }
    }

    /**
     * Extracts active telemetry blocks to feed the Decision / Risk Engine pre-execution bounds.
     */
    async getRouteTelemetry(routeSignature) {
        try {
            const res = await this.pool.query(`SELECT * FROM route_metrics WHERE route_signature = $1`, [routeSignature]);
            if (res.rows.length === 0) return { exists: false, win_rate: 0.0, revert_rate: 0.0, avg_quote_drift_bps: 0, stale_quote_rate: 0.0 };
            return { exists: true, ...res.rows[0] };
        } catch (e) {
            return { exists: false, win_rate: 0.0, revert_rate: 0.0, avg_quote_drift_bps: 0 };
        }
    }
    
    async checkAnomalyBlacklists(routeSignature, chain) {
        try {
            // Evaluates live global circuit breakers and localized route soft/hard-bans
            const res = await this.pool.query(
                `SELECT * FROM blacklists WHERE (entity_value = $1 OR entity_type = 'GLOBAL_CHAIN') AND chain = $2 AND expires_at > CURRENT_TIMESTAMP`, 
                [routeSignature, chain]
            );
            return { isBlacklisted: res.rows.length > 0, reason: res.rows.length > 0 ? res.rows[0].reason : null };
        } catch (e) {
            return { isBlacklisted: false };
        }
    }
}

module.exports = new LearningEngine();
