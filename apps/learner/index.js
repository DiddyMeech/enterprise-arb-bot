const { Client } = require('pg');
const { logger } = require('@arb/telemetry');
const config = require('@arb/config');

class LearnerApp {
    constructor() {
        this.pg = new Client({ connectionString: config.DATABASE_URL });
        logger.info("[LEARNER] Initializing Machine Learning & Analytics Control Engine");
    }

    async start() {
        await this.pg.connect();
        
        // Periodic Evaluation Loop
        setInterval(() => this.analyzePerformance(), 600000); // Trigger evaluations every 10m
        this.analyzePerformance(); // Initial trigger
    }

    async analyzePerformance() {
        logger.info("[LEARNER] Commencing SQL trade performance analysis crunch...");

        try {
            // 1. Scoring & Predictive Blacklisting
            // Detect token pairs with > 3 failures in the last 24h
            const query = `
                SELECT dex_combo, token_in, token_out, COUNT(*) as fail_count 
                FROM failures f
                JOIN trades t ON f.trade_id = t.id
                JOIN opportunities o ON t.opportunity_id = o.id
                WHERE f.timestamp > NOW() - INTERVAL '24 hours'
                GROUP BY 1, 2, 3
                HAVING COUNT(*) > 3
            `;
            const result = await this.pg.query(query);

            for (const row of result.rows) {
                logger.warn(`[LEARNER] AUTO-BLACKLIST: ${row.dex_combo} route (${row.token_in} -> ${row.token_out}) failing persistently (${row.fail_count} recent fails). Initiating ban.`);
                
                // Write ban strictly back into tracking db to restrict future Simulator runs
                await this.pg.query(
                    `INSERT INTO strategy_metrics (pair, dex_combo, banned) VALUES ($1, $2, true) ON CONFLICT DO NOTHING`,
                    [`${row.token_in}-${row.token_out}`, row.dex_combo]
                );
            }

            // 2. Adaptive Thresholds Tuning
            // Analyzes average win rate vs gas expenditures
            const stats = await this.pg.query(`
                SELECT AVG(actual_profit_usd) as avg_profit, AVG(gas_used_usd) as avg_gas 
                FROM trades WHERE status = 'SUCCESS' AND timestamp > NOW() - INTERVAL '24 hours'
            `);
            
            if (stats.rows.length > 0 && stats.rows[0].avg_profit) {
                logger.info(`[LEARNER] 24H Review: Avg Profit: $${parseFloat(stats.rows[0].avg_profit).toFixed(2)} | Avg Gas: $${parseFloat(stats.rows[0].avg_gas).toFixed(2)}`);
            }

        } catch (error) {
            logger.error(`[LEARNER] Analytics computation failure: ${error.message}`);
        }
    }
}

new LearnerApp().start();
