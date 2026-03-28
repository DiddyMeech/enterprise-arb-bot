const express = require('express');
const promClient = require('prom-client');
const { Pool } = require('pg');
const config = require('@arb/config');
const { logger } = require('@arb/telemetry');
const cors = require('cors');

const app = express();
app.use(cors()); // Critical for Vite Frontend access

const port = process.env.DASHBOARD_PORT || 9091;

// Prometheus Registry Map
const register = new promClient.Registry();
promClient.collectDefaultMetrics({ register });

const pool = new Pool({ connectionString: config.DATABASE_URL });

const winRateGauge = new promClient.Gauge({ name: 'arb_win_rate', help: 'Current pipeline execution win rate across sequences' });
const dailyProfitGauge = new promClient.Gauge({ name: 'arb_daily_profit_usd', help: '24 Hour Total Net Profit' });
const routeDriftGauge = new promClient.Gauge({ name: 'arb_avg_quote_drift', help: 'Current mathematical deviation between trace and execution' });
const blacklistedRoutesGauge = new promClient.Gauge({ name: 'arb_blacklisted_routes', help: 'Number of active dynamically banned traces' });
const activeCircuitBreakers = new promClient.Gauge({ name: 'arb_circuit_breakers_active', help: 'Count of triggered global safety pauses' });

register.registerMetric(winRateGauge);
register.registerMetric(dailyProfitGauge);
register.registerMetric(routeDriftGauge);
register.registerMetric(blacklistedRoutesGauge);
register.registerMetric(activeCircuitBreakers);

// Polling interval to export SQL schemas mapped directly to Grafana arrays
setInterval(async () => {
    try {
        const stats = await pool.query(`SELECT AVG(win_rate) as w_rate, AVG(avg_quote_drift_bps) as q_drift FROM route_metrics;`);
        winRateGauge.set(parseFloat(stats.rows[0]?.w_rate || 0));
        routeDriftGauge.set(parseFloat(stats.rows[0]?.q_drift || 0));

        const profit = await pool.query(`SELECT SUM(actual_net_profit_usd) as p_usd FROM execution_results WHERE timestamp > NOW() - INTERVAL '24 HOURS' AND status = 'WIN';`);
        dailyProfitGauge.set(parseFloat(profit.rows[0]?.p_usd || 0));

        const blacklists = await pool.query(`SELECT COUNT(*) as b_count FROM blacklists WHERE expires_at > CURRENT_TIMESTAMP;`);
        blacklistedRoutesGauge.set(parseInt(blacklists.rows[0]?.b_count || 0));

        const pauses = await pool.query(`SELECT COUNT(*) as c_count FROM pause_events WHERE timestamp > NOW() - INTERVAL '1 HOUR';`);
        activeCircuitBreakers.set(parseInt(pauses.rows[0]?.c_count || 0));
        
    } catch (e) {
        console.error(`[DASHBOARD-METRICS] Interval Poll Fault: ${e.message}`);
    }
}, 15000); // 15s extraction loops matching Grafana defaults

app.get('/metrics', async (req, res) => {
    try {
        res.set('Content-Type', register.contentType);
        res.end(await register.metrics());
    } catch (err) {
        res.status(500).end(err);
    }
});

app.get('/health', (req, res) => {
    res.json({ status: 'HEALTHY', active_layer: config.POLICY.bot_mode });
});

// React Dashboard UI Endpoints
app.get('/api/stats', async (req, res) => {
    try {
        const profitRow = await pool.query(`SELECT SUM(actual_net_profit_usd) as total_profit FROM execution_results WHERE status = 'WIN';`);
        const totalProfit = parseFloat(profitRow.rows[0]?.total_profit || 0);
        
        const countRow = await pool.query(`SELECT COUNT(*) as total_trades FROM execution_results;`);
        const totalTrades = parseInt(countRow.rows[0]?.total_trades || 0);

        const winRow = await pool.query(`SELECT COUNT(*) as win_trades FROM execution_results WHERE status = 'WIN';`);
        const winTrades = parseInt(winRow.rows[0]?.win_trades || 0);
        
        const winRate = totalTrades > 0 ? (winTrades / totalTrades) * 100 : 0;

        res.json({
            status: 'success',
            data: {
                totalProfitUsd: totalProfit,
                totalTrades: totalTrades,
                winRate: winRate,
                uptimeHours: process.uptime() / 3600
            }
        });
    } catch (e) {
        console.error(`[API ERROR] Stats computation fault: ${e.message}`);
        res.status(500).json({ status: 'error', message: 'Internal Server Error' });
    }
});

app.get('/api/executions', async (req, res) => {
    try {
        const execs = await pool.query(`
            SELECT execution_id, route_id, status, expected_net_profit_usd, actual_net_profit_usd, timestamp 
            FROM execution_results 
            ORDER BY timestamp DESC 
            LIMIT 20;
        `);
        res.json({ status: 'success', data: execs.rows });
    } catch (e) {
        console.error(`[API ERROR] Executions computation fault: ${e.message}`);
        res.status(500).json({ status: 'error', message: 'Internal Server Error' });
    }
});

app.listen(port, () => {
    console.log(`[DASHBOARD] Prometheus active telemetry stream live on :${port}/metrics`);
});
