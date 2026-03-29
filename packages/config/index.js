require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { riskPolicySchema } = require('./validator');

// Load and Validate Zero-Trust Risk Policy constraints
const policyPath = path.resolve(__dirname, '../../config/risk-policy.yaml');
const policyFile = fs.readFileSync(policyPath, 'utf8');
const parsedPolicy = yaml.load(policyFile);

const { error, value: riskPolicy } = riskPolicySchema.validate(parsedPolicy);
if (error) {
    console.error("\n❌ CRITICAL STARTUP HALT: Invalid config/risk-policy.yaml constraints detected.");
    console.error(error.details[0].message + "\n");
    process.exit(1);
}

const config = {
    POLICY: riskPolicy, // Natively embed Phase 2 strict thresholds into memory
    SAFE_MODE: process.env.SAFE_MODE !== 'false', // ⚠️ Default to true (simulate only) per strict startup risk controls
    PRIVATE_KEY: process.env.PRIVATE_KEY,
    ARB_CONTRACT_ADDRESS: process.env.ARB_CONTRACT_ADDRESS || "0xArbContract", // Dynamically populated via deploy.js
    DATABASE_URL: process.env.DATABASE_URL || 'postgresql://arbuser:arbpassword@localhost:5432/arbdb',
    REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',
    ORACLES: {
        COINGECKO: process.env.COINGECKO_API_KEY,
        ONEINCH: process.env.ONEINCH_API_KEY,
        THEGRAPH: process.env.THEGRAPH_API_KEY
    },
    MEV_RELAYS: {
        BLOXROUTE_AUTH: process.env.BLOXROUTE_AUTH_HEADER,
        FLASHBOTS: process.env.FLASHBOTS_RELAY || 'https://relay.flashbots.net',
        FLASHBOTS_KEY: process.env.FLASHBOTS_KEY
    },
    
    // Core Hard Constraints (Learner engine can tighten these but never loosen past these base maximums)
    MIN_PROFIT_USD: parseFloat(process.env.MIN_PROFIT_USD || '40'),
    MAX_GAS_PROFIT_RATIO: 0.30, // Max 30% of gross profit can be spent on gas estimation
    MAX_SLIPPAGE_BPS: 100, // 1.0% maximum acceptable localized slippage limit
    MAX_ROUTE_HOPS: 3,     // V1 Architecture Limit
    POOL_AGE_DAYS_MIN: 7,  // Strict Honey-pot resistance

    CHAINS: {
        ARBITRUM: {
            id: 42161,
            name: "Arbitrum",
            pollingInterval: 100, 
            wss: process.env.ARB_WSS_SCAN, // Upgraded memory stream mapping
            rpcs: [
                process.env.ARB_RPC_SCAN,
                process.env.ARB_RPC_EXEC,
                process.env.ARB_RPC_CONF
            ].filter(Boolean)
        },
        BASE: {
            id: 8453,
            name: "Base",
            pollingInterval: 200, 
            wss: process.env.BASE_WSS_SCAN, // Upgraded memory stream mapping
            rpcs: [
                process.env.BASE_RPC_SCAN,
                process.env.BASE_RPC_EXEC,
                process.env.BASE_RPC_CONF
            ].filter(Boolean)
        },
        OP: {
            id: 10,
            name: "Optimism",
            pollingInterval: 100, 
            wss: process.env.OP_WSS_SCAN, 
            rpcs: [
                process.env.OP_RPC_SCAN,
                process.env.OP_RPC_EXEC,
                process.env.OP_RPC_CONF
            ].filter(Boolean)
        }
    }
};

module.exports = config;
