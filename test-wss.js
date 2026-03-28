const WebSocket = require('ws');
require('dotenv').config();
const testWSS = (name, url) => {
    if(!url) { console.log(`[${name}] No URL`); return; }
    const ws = new WebSocket(url);
    ws.on('open', () => {
        console.log(`[${name}] Connected. Subscribing...`);
        ws.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_subscribe", params: ["newPendingTransactions"] }));
    });
    ws.on('message', (data) => console.log(`[${name}] Message: ${data}`));
    ws.on('error', (err) => console.log(`[${name}] Error: ${err.message}`));
    setTimeout(() => { ws.close(); }, 3000);
}
testWSS('Arbitrum', process.env.ARB_WSS_SCAN);
testWSS('Base', process.env.BASE_WSS_SCAN);
testWSS('BSC', process.env.BSC_WSS_SCAN);
