const fs = require('fs');
const { ethers } = require('ethers');
const { execSync } = require('child_process');

const VALID_HITS_FILE = '/home/meech/Desktop/Titan-main/brain/loot_and_logs/Uncategorized/WEB3_RPC_NODES/VALID_HITS.md';
const ENV_PATH = require('path').resolve(__dirname, '../.env');

async function checkRpc(url, expectedChainId) {
    try {
        const provider = new ethers.providers.StaticJsonRpcProvider(url, expectedChainId);
        // Force the provider to aggressively resolve chain networking directly
        const network = await provider.getNetwork();
        return network.chainId === expectedChainId;
    } catch {
        return false; // Silently drop unauthorized/402 endpoints
    }
}

async function main() {
    console.log(`\n========================================`);
    console.log(`[RPC-MANAGER] Ingesting cracked targets from ${VALID_HITS_FILE}`);
    
    if (!fs.existsSync(VALID_HITS_FILE)) {
        console.error('[RPC-MANAGER] File not found at strict path!');
        process.exit(1);
    }

    const content = fs.readFileSync(VALID_HITS_FILE, 'utf-8');
    // Regex universally matches all URL boundaries logged by the checker module
    const urls = [...content.matchAll(/URL: (https:\/\/[^\s]+)/g)].map(m => m[1]);
    console.log(`[RPC-MANAGER] Extracted ${urls.length} raw proxy targets.`);

    const arbs = [];
    const bases = [];

    // Launch aggressive concurrent node verification
    console.log(`[RPC-MANAGER] Auditing active node availability. This takes a few seconds...`);
    const checks = urls.map(async url => {
        if (url.includes('arbitrum') || url.includes('arb-mainnet')) {
            if (await checkRpc(url, 42161)) arbs.push(url);
        } else if (url.includes('base') && !url.includes('sepolia')) { // hard drop testnets
            if (await checkRpc(url, 8453)) bases.push(url);
        }
    });

    await Promise.all(checks);
    
    console.log(`[RPC-MANAGER] Verified ${arbs.length} Elite Arbitrum Nodes successfully.`);
    console.log(`[RPC-MANAGER] Verified ${bases.length} Elite Base Nodes successfully.`);

    if (arbs.length === 0 && bases.length === 0) {
       console.log('[RPC-MANAGER] No viable keys located. Quitting pipeline.');
       return;
    }

    // Mutate and permanently cache the arrays natively into the local .env block
    let env = fs.readFileSync(ENV_PATH, 'utf-8');
    
    if (arbs.length > 0) {
        if (env.includes('ARB_RPC_NODES=')) {
            env = env.replace(/ARB_RPC_NODES=.*/, `ARB_RPC_NODES=${arbs.join(',')}`);
        } else {
            env += `\n# --- Dynamic Load-Balanced Node Arrays --- \nARB_RPC_NODES=${arbs.join(',')}\n`;
        }
    }
    
    if (bases.length > 0) {
        if (env.includes('BASE_RPC_NODES=')) {
            env = env.replace(/BASE_RPC_NODES=.*/, `BASE_RPC_NODES=${bases.join(',')}`);
        } else {
            env += `BASE_RPC_NODES=${bases.join(',')}\n`;
        }
    }

    fs.writeFileSync(ENV_PATH, env);
    console.log('[RPC-MANAGER] Successfully injected valid targets into local .env registry.');

    // Fire synchronization event to perfectly push the configuration cleanly to active VPS
    console.log('[RPC-MANAGER] Establishing encrypted tunnel and deploying live arrays to VPS Execution Drone...');
    try {
        execSync('scp -i ~/.ssh/titan_droplet_key -o StrictHostKeyChecking=no .env root@134.122.5.13:/root/enterprise-arb-bot/.env', { stdio: 'inherit', cwd: require('path').resolve(__dirname, '..') });
        execSync('ssh -i ~/.ssh/titan_droplet_key -o StrictHostKeyChecking=no root@134.122.5.13 "cd /root/enterprise-arb-bot && npx pm2 restart all --update-env"', { stdio: 'inherit' });
        console.log('\n[RPC-MANAGER] Pipeline Bridge Complete. Drones are actively executing on Elite Proxies.');
        console.log(`========================================\n`);
    } catch(e) {
        console.error('[RPC-MANAGER] Error orchestrating deploy proxy:', e.message);
    }
}

main();
