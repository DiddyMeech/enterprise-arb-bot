const config = require('@arb/config');
// Removed cyclic logger
const https = require('https');

class AlertNotifier {
    /**
     * Executes native POST requests bypassing heavy external dependencies like Axios.
     */
    async postRequest(url, data) {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (!response.ok) {
            throw new Error(`HTTP Error: ${response.status} ${response.statusText}`);
        }
        return response.status;
    }

    async sendWinAlert(opp, actuals) {
        const webhookDiscord = process.env.DISCORD_WEBHOOK_URL;
        const tgToken = process.env.TELEGRAM_BOT_TOKEN;
        const tgChatId = process.env.TELEGRAM_CHAT_ID;

        if (!webhookDiscord && !tgToken) return;

        const message = `🚨 <b>ARBITRAGE WIN!</b> 🚨\n\n` +
                        `⛓️ <b>Chain:</b> ${opp.chain}\n` +
                        `🔄 <b>Route:</b> ${opp.routeSignature}\n` +
                        `💰 <b>Net Profit:</b> $${actuals.netProfitUsd.toFixed(2)}\n` +
                        `⛽ <b>Builder Tip Paid:</b> $${actuals.gasPaidUsd.toFixed(2)}\n` +
                        `⏱️ <b>Latency:</b> ${actuals.latencyMs}ms\n` +
                        `🎯 <b>Execution ID:</b> <code>${actuals.execId}</code>`;

        try {
            if (webhookDiscord) {
                await this.postRequest(webhookDiscord, { content: message });
            }
            if (tgToken && tgChatId) {
                const tgUrl = `https://api.telegram.org/bot${tgToken}/sendMessage`;
                await this.postRequest(tgUrl, { chat_id: tgChatId, text: message, parse_mode: 'HTML' });
            }
            console.log(`[NOTIFICATIONS] Successfully fired Win Alert to Operator!`);
        } catch (e) {
            console.error(`[NOTIFICATIONS] Failed to fire push alert: ${e.message}`);
        }
    }
}

module.exports = new AlertNotifier();
