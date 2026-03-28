require('dotenv').config({ path: '../.env' });
const { ethers } = require('ethers');

const endpoints = [
    { name: "ARB_RPC_SCAN", url: process.env.ARB_RPC_SCAN },
    { name: "ARB_RPC_EXEC", url: process.env.ARB_RPC_EXEC },
    { name: "ARB_RPC_CONF", url: process.env.ARB_RPC_CONF },
    { name: "BASE_RPC_SCAN", url: process.env.BASE_RPC_SCAN },
    { name: "BASE_RPC_EXEC", url: process.env.BASE_RPC_EXEC },
    { name: "BASE_RPC_CONF", url: process.env.BASE_RPC_CONF },
    { name: "BSC_RPC_SCAN", url: process.env.BSC_RPC_SCAN },
    { name: "BSC_RPC_EXEC", url: process.env.BSC_RPC_EXEC },
    { name: "BSC_RPC_CONF", url: process.env.BSC_RPC_CONF }
];

async function checkEnds() {
    console.log("=== EXECUTING ELITE RPC VALIDATION STRAP ===\n");
    for (const ep of endpoints) {
        if (!ep.url) {
            console.log(`[SKIP] ${ep.name} is missing in .env`);
            continue;
        }
        try {
            const start = Date.now();
            const provider = new ethers.providers.JsonRpcProvider(ep.url);
            const block = await provider.getBlockNumber();
            const latency = Date.now() - start;
            console.log(`[ACTIVE] ${ep.name.padEnd(14)} | Block: ${String(block).padEnd(9)} | Latency: ${latency}ms`);
        } catch (e) {
            console.log(`[DEAD]   ${ep.name.padEnd(14)} | Error: ${e.message.split(' (')[0]}`);
        }
    }
}
checkEnds();
