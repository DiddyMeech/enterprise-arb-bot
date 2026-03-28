const cron = require('node-cron');
const config = require('@arb/config');
const { logger } = require('@arb/telemetry');
const learningEngine = require('@arb/learning-engine');

class DailyTuner {
    constructor() {
        this.policy = config.POLICY;
    }

    async runTuningCycle() {
        try {
            logger.info(`[DAILY-TUNER] Beginning 24h Algorithmic Tuning Cycle Execution...`);
            
            // 1. Aggregate Previous Day Results
            const report = {
                routesAnalyzed: 0,
                routesPromoted: 0,
                routesDemoted: 0,
                blacklistsCreated: 0
            };

            // Calculate threshold boundaries based on policy limits
            const { tuning, learning, risk } = this.policy;

            if (!learning.daily_adjustment_enabled) {
                logger.info(`[DAILY-TUNER] Engine bypassed -> learning.daily_adjustment_enabled = false`);
                return;
            }

            // A PostgreSQL extraction pulling structural metrics over the last 24H 
            // Querying `execution_results` and `route_metrics` via learningEngine
            const analysisQuery = `
                SELECT rm.route_signature, rm.chain, rm.win_rate, rm.revert_rate, rm.avg_quote_drift_bps,
                       COUNT(er.id) as 24h_volume,
                       SUM(er.actual_net_profit_usd) as 24h_profit
                FROM route_metrics rm
                LEFT JOIN execution_results er ON rm.route_signature = er.route_signature
                WHERE er.timestamp > NOW() - INTERVAL '24 HOURS'
                GROUP BY rm.route_signature
                HAVING COUNT(er.id) >= $1;
            `;
            
            // Execute the bounded SQL aggregation
            const routes = await learningEngine.pool.query(analysisQuery, [learning.min_samples_for_route_confidence]);
            report.routesAnalyzed = routes.rowCount;

            for (const route of routes.rows) {
                // Rule: Demote unstable routes (Drift rising, revert rate rising)
                if (route.revert_rate > 0.4 || route.avg_quote_drift_bps > risk.max_quote_to_fill_drift_bps) {
                    await this.enforceDemotion(route);
                    report.routesDemoted++;
                }
                
                // Rule: Promote highly reliable, consistent routes
                if (route.win_rate > 0.85 && route['24h_profit'] > risk.target_profit_floor_usd) {
                    await this.enforcePromotion(route);
                    report.routesPromoted++;
                }

                // Rule: Auto-Blacklist critically failing routes 
                // e.g., zero profit, severe slippage over the short/long window requirements
                if (route.revert_rate >= 0.9 && route['24h_volume'] >= risk.route_blacklist_failures_long_window) {
                    await this.enforceBlacklist(route, risk.blacklist_long_minutes);
                    report.blacklistsCreated++;
                }
            }

            // Store Tuning Run Audit Trail
            await learningEngine.pool.query(
                `INSERT INTO tuning_runs (chains_analyzed, routes_analyzed, action_count) VALUES ($1, $2, $3)`,
                [Object.keys(this.policy.chains).length, report.routesAnalyzed, report.routesDemoted + report.routesPromoted]
            );

            logger.info(`[DAILY-TUNER] Cycle Concluded. Analyzed: ${report.routesAnalyzed} | Promoted: ${report.routesPromoted} | Demoted: ${report.routesDemoted} | Banned: ${report.blacklistsCreated}`);
            
            if (tuning.export_report) {
                logger.info(`[DAILY-TUNER] Generated Tuning Report Audit payload natively into database constraints.`);
            }

        } catch (err) {
            logger.error(`[DAILY-TUNER] Critical error during daily aggregation routine: ${err.message}`);
        }
    }

    async enforceDemotion(route) {
        // Reduces algorithmic capacity boundaries locally. Never overrides hard safeties.
        await learningEngine.pool.query(
            `UPDATE route_metrics SET current_score = current_score * 0.85 WHERE route_signature = $1`,
            [route.route_signature]
        );
        logger.warn(`[DAILY-TUNER] 👇 DEMOTED Route [${route.route_signature}] due to high revert/drift trace.`);
    }

    async enforcePromotion(route) {
        // Boosts algorithmic capacity. Strict clamping to max bounds 1.0.
        await learningEngine.pool.query(
            `UPDATE route_metrics SET current_score = LEAST(current_score * 1.15, 1.0) WHERE route_signature = $1`,
            [route.route_signature]
        );
        logger.info(`[DAILY-TUNER] 🚀 PROMOTED Route [${route.route_signature}] reflecting massive 24h confidence.`);
    }

    async enforceBlacklist(route, durationMinutes) {
        // Embed the global routing limit preventing any execution
        await learningEngine.pool.query(
            `INSERT INTO blacklists (entity_type, entity_value, chain, ban_level, reason, expires_at)
             VALUES ('ROUTE', $1, $2, 'HARD', 'Auto-Tuner Critical Revert Saturation', NOW() + INTERVAL '${durationMinutes} MINUTES')`,
            [route.route_signature, route.chain]
        );
        logger.warn(`[DAILY-TUNER] ⛔ BLACKLISTED Route [${route.route_signature}] for ${durationMinutes} minutes.`);
    }

    start() {
        const h = this.policy.tuning.run_every_hours;
        logger.info(`[DAILY-TUNER] Scheduling Autonomous Aggregation daemon to execute every ${h} hours.`);
        
        // Cron string e.g. every 24h at 00:00 -> '0 0 * * *'
        // Simple interval for dynamic configurations:
        setInterval(() => {
            this.runTuningCycle();
        }, h * 60 * 60 * 1000); // Convert hours to milliseconds

        // Run an initial phase right now exclusively in SAFE mode bounds mapping
        if (this.policy.mode.bot_mode === 'SAFE') {
            setTimeout(() => this.runTuningCycle(), 15000); // 15-sec boot delay
        }
    }
}

const tuner = new DailyTuner();
tuner.start();
