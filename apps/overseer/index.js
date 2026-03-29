const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { Pool } = require('pg');
const config = require('@arb/config');
const { logger } = require('@arb/telemetry');

class AIOverseer {
    constructor() {
        this.pool = new Pool({ connectionString: config.DATABASE_URL });
        this.envPath = path.resolve(__dirname, '../../.env');
        this.apiKey = process.env.OPENROUTER_API_KEY;
        
        logger.info("[OVERSEER] AI Autopilot Daemon Initiated.");
    }

    start() {
        if (!this.apiKey) {
            logger.warn("[OVERSEER] OPENROUTER_API_KEY not found in .env. Sleeping strictly until key is provided.");
            return; // Will check again upon pm2 restart
        }

        // Trigger autonomous environment audits every 2 hours
        setInterval(() => this.auditEnvironment(), 7200000); 
        this.auditEnvironment();
    }

    async auditEnvironment() {
        logger.info("[OVERSEER] Gathering SQL performance matrices for LLM prompting...");

        try {
            // Pull strictly recent 24-hour aggregates
            const stats = await this.pool.query(`
                SELECT 
                    COUNT(*) as total_trades,
                    SUM(CASE WHEN status = 'WIN' THEN 1 ELSE 0 END) as win_trades,
                    AVG(actual_net_profit_usd) as avg_profit, 
                    AVG(actual_gas_paid_usd) as avg_gas 
                FROM execution_results 
                WHERE timestamp > NOW() - INTERVAL '24 hours'
            `);

            const row = stats.rows[0];
            const total = parseInt(row.total_trades || 0);
            const wins = parseInt(row.win_trades || 0);
            const winRate = total > 0 ? (wins / total) * 100 : 0;
            const avgProfit = parseFloat(row.avg_profit || 0);
            const avgGas = parseFloat(row.avg_gas || 0);

            const currentMinProfit = process.env.MIN_PROFIT_USD || 50;

            const prompt = `
You are the Titan 2.0 Autonomous Workspace Overseer. You govern an elite Arbitrage MEV cluster.
Your objective is to mathematically protect capital and dynamically optimize the bot's execution thresholds.

CURRENT LATENCY MATRICES (Last 24H):
Total Broadcasts: ${total}
Win Rate: ${winRate.toFixed(2)}%
Average Net Profit (When Won): $${avgProfit.toFixed(2)}
Average Gas Paid: $${avgGas.toFixed(2)}

CURRENT HYPERPARAMETERS:
MIN_PROFIT_USD=${currentMinProfit}

INSTRUCTIONS:
1. Evaluate if the MIN_PROFIT_USD threshold is bleeding capital. If the win rate is under 50% or gas far exceeds profit margins, you must RAISE the MIN_PROFIT_USD limit. If the win rate is >90% and gas is cheap, you can LOWER the limit to capture more volume.
2. MEV RELAY MONITORING: The user is operating using a shared "FLASHBOTS_KEY". If "Total Broadcasts" scales massively but the "Win Rate" is 0%, it is highly probable the MEV Relay is dropping the bundles due to rate-limiting. If detected, explicitly state this diagnosis in your reasoning string!
You must reply STRICTLY with a valid JSON object matching this schema and absolutely nothing else. No markdown wrappers.

{
  "recommended_min_profit_usd": <number>,
  "reasoning": "<string concise explanation>"
}
            `;

            logger.info("[OVERSEER] Booting API query to OpenRouter AI Core...");

            const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${this.apiKey}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    model: "anthropic/claude-3.5-sonnet", // Elite top-tier reasoning engine for flawless mathematical optimizations
                    messages: [{ role: "user", content: prompt }]
                })
            });

            if (!response.ok) throw new Error(`LLM Context Rejection: ${response.status}`);

            const jsonOutput = await response.json();
            const aiRaw = jsonOutput.choices[0].message.content.trim();
            const aiDirective = JSON.parse(aiRaw);

            logger.info(`[OVERSEER] Sub-System Agent dictates: ${aiDirective.reasoning}`);

            let nextLimit = aiDirective.recommended_min_profit_usd;
            
            // USER OVERRIDE: Mathematically constrain the AI from exceeding 20 USD limits to target high-frequency daily payouts.
            if (nextLimit && nextLimit > 20) {
                logger.warn(`[OVERSEER] AI generated $${nextLimit} limit blocked. Enforcing User Max Threshold: $20.`);
                nextLimit = 20;
            }

            if (nextLimit && nextLimit != currentMinProfit) {
                this.mutatorEngineWrite(nextLimit);
            } else {
                logger.info("[OVERSEER] AI determined current parameters are mathematically optimal. Standing down.");
            }

        } catch (e) {
            logger.error(`[OVERSEER] AI Cognitive computation failure: ${e.message}`);
        }
    }

    mutatorEngineWrite(newLimit) {
        logger.warn(`[OVERSEER] AUTONOMOUS ENVIRONMENT OVERWRITE INITIATED. Adjusting MIN_PROFIT_USD to ${newLimit}`);

        try {
            let envContent = fs.readFileSync(this.envPath, 'utf8');
            
            // Safely iterate over each line to replace the constraint dynamically
            const lines = envContent.split('\n');
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].startsWith('MIN_PROFIT_USD=')) {
                    lines[i] = `MIN_PROFIT_USD=${newLimit}`;
                }
            }
            envContent = lines.join('\n');
            
            fs.writeFileSync(this.envPath, envContent, 'utf8');

            logger.warn("[OVERSEER] Environment physically overwritten. Sending PM2 SIGINT command for total cluster reload.");
            
            exec('npx pm2 reload all --force', (error, stdout, stderr) => {
                if (error) {
                    logger.error(`[OVERSEER] OS Core Fault during reload execution: ${error.message}`);
                    return;
                }
                logger.info("[OVERSEER] Live PM2 Cluster organically rebooted. Memory flushed. New parameters active natively.");
            });

        } catch (e) {
            logger.error(`[OVERSEER] File I/O Permissions violation during Env overwrite: ${e.message}`);
        }
    }
}

const daemon = new AIOverseer();
daemon.start();

// Ensure process remains permanently bound to PM2 if API keys are missing to natively stop crash-loops
setInterval(() => {}, 60000);

module.exports = daemon;
