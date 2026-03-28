const https = require('https');
const fs = require('fs');

// Extract current API keys structurally
const rawEnv = fs.readFileSync('../.env', 'utf8');
const env = {};
rawEnv.split('\n').forEach(line => {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) env[match[1].trim()] = match[2].trim();
});

const endpoints = [
    { name: "ARB_RPC_SCAN", url: env.ARB_RPC_SCAN },
    { name: "ARB_RPC_EXEC", url: env.ARB_RPC_EXEC },
    { name: "ARB_RPC_CONF", url: env.ARB_RPC_CONF },
    { name: "BASE_RPC_SCAN", url: env.BASE_RPC_SCAN },
    { name: "BASE_RPC_EXEC", url: env.BASE_RPC_EXEC },
    { name: "BASE_RPC_CONF", url: env.BASE_RPC_CONF },
    { name: "BSC_RPC_SCAN", url: env.BSC_RPC_SCAN },
    { name: "BSC_RPC_EXEC", url: env.BSC_RPC_EXEC },
    { name: "BSC_RPC_CONF", url: env.BSC_RPC_CONF }
];

function rpcCall(url) {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        // Pure `eth_blockNumber` JSON-RPC specification bypasses the need for the heavy Ethers library
        const postData = JSON.stringify({ "jsonrpc": "2.0", "method": "eth_blockNumber", "params": [], "id": 1 });
        
        const req = https.request({
            hostname: u.hostname,
            path: u.pathname + u.search,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) },
            timeout: 5000
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        const parsed = JSON.parse(data);
                        if (parsed.result) resolve(parseInt(parsed.result, 16));
                        else reject(new Error("Corrupted Response: " + data));
                    } catch(e) { reject(new Error("Parse fail: " + data)); }
                } else {
                    reject(new Error(`HTTP ${res.statusCode} -> ${data}`));
                }
            });
        });
        req.on('timeout', () => { req.destroy(); reject(new Error("Network Timeout threshold reached")); });
        req.on('error', reject);
        req.write(postData);
        req.end();
    });
}

async function checkEnds() {
    console.log("=== EXECUTING NATIVE ZERO-DEPENDENCY RPC VALIDATION ===\n");
    for (const ep of endpoints) {
        if (!ep.url) {
            console.log(`[SKIP]   ${ep.name.padEnd(14)} | Token completely missing in .env config`);
            continue;
        }
        try {
            const start = Date.now();
            const block = await rpcCall(ep.url);
            const latency = Date.now() - start;
            console.log(`[ACTIVE] ${ep.name.padEnd(14)} | Block Chain Height: ${String(block).padEnd(9)} | Latency: ${latency}ms`);
        } catch (e) {
            let msg = e.message;
            if (msg.includes('socket hang up') || msg.includes('ECONNRESET')) msg = "Connection refused/reset externally";
            else if (msg.length > 50) msg = msg.substring(0, 47) + "...";
            console.log(`[DEAD]   ${ep.name.padEnd(14)} | Verification Error: ${msg}`);
        }
    }
}

checkEnds();
