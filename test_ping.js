require('dotenv').config({ path: './.env' });
const notifier = require('./packages/telemetry/notifier');

async function executeTestPing() {
    console.log("=== 📡 FIRING TEST TELEGRAM PING ===");
    
    // Construct mock opportunity and execution trace
    const mockOpp = {
        chain: 'Arbitrum-Testnet',
        routeSignature: 'INITIALIZATION_PING_TEST'
    };
    
    const mockActuals = {
        status: 'WIN',
        netProfitUsd: 999.99,
        gasPaidUsd: 0.00, // Gasless EIP-1559 Verification
        latencyMs: 85,
        execId: 'system-auth-ping-001'
    };

    try {
        await notifier.sendWinAlert(mockOpp, mockActuals);
        console.log("=== ✅ PING SUCCESSFULLY DISPATCHED TO API ===");
    } catch (err) {
        console.error("❌ PING FAILED:", err.message);
    }
}

executeTestPing();
