const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
const { execSync } = require('child_process');

const LOOT_DIR = '/home/meech/Desktop/enterprise-arb-bot/titan_auto_hunter/brain/loot_and_logs/Uncategorized';
const ENV_PATH = require('path').resolve(__dirname, '../.env');

// Recursively walks the entire nested directory tree to find every target payload
function findFilesInDir(startPath, filter) {
    let results = [];
    if (!fs.existsSync(startPath)) return results;
    
    const files = fs.readdirSync(startPath);
    for (let i = 0; i < files.length; i++) {
        let filename = path.join(startPath, files[i]);
        let stat = fs.lstatSync(filename);
        if (stat.isDirectory()) {
            results = results.concat(findFilesInDir(filename, filter)); 
        } else if (filename.indexOf(filter) >= 0 || filename.endsWith('.txt')) {
            results.push(filename);
        }
    }
    return results;
}

async function checkRpc(url, expectedChainId) {
    try {
        const provider = new ethers.providers.StaticJsonRpcProvider(url, expectedChainId);
        const network = await provider.getNetwork();
        return network.chainId === expectedChainId;
    } catch {
        return false;
    }
}

async function main() {
    console.log(`\n========================================`);
    console.log(`[RPC-MANAGER] Initializing global recursive sweep across ${LOOT_DIR}...`);
    
    const targetFiles = findFilesInDir(LOOT_DIR, '.md');
    console.log(`[RPC-MANAGER] Located ${targetFiles.length} raw data vaults.`);

    let allUrls = new Set();
    
    for (const file of targetFiles) {
        try {
            const content = fs.readFileSync(file, 'utf-8');
            const matches = [...content.matchAll(/(https:\/\/[a-zA-Z0-9-._~:/?#[\]@!$&'()*+,;=]+)/g)].map(m => m[1]);
            matches.forEach(url => {
                if(
                    url.includes('alchemy.com') || 
                    url.includes('infura.io') || 
                    url.includes('quiknode.pro') ||
                    url.includes('chainstack.com') ||
                    url.includes('blastapi.io') ||
                    url.includes('ankr.com') ||
                    url.includes('drpc.org')
                ) {
                    allUrls.add(url);
                }
            });
        } catch(e) {}
    }

    const urls = Array.from(allUrls);
    console.log(`[RPC-MANAGER] Aggregated ${urls.length} unique proxy candidates across all domains.`);
    console.log(`[RPC-MANAGER] Auditing active node availability (Target: 15 per network). Evaluating...`);

    const arbs = [];
    const bases = [];

    // Chunk size execution to prevent aggressive local network socket exhaustion
    const CHUNK_SIZE = 50;
    for (let i = 0; i < urls.length; i += CHUNK_SIZE) {
        if (arbs.length >= 15 && bases.length >= 15) break; 
        
        const chunk = urls.slice(i, i + CHUNK_SIZE);
        const checks = chunk.map(async url => {
            if (url.includes('arbitrum') || url.includes('arb-mainnet')) {
                if (arbs.length < 15 && await checkRpc(url, 42161)) arbs.push(url);
            } else if (url.includes('base') && !url.includes('sepolia') && !url.includes('goerli')) {
                if (bases.length < 15 && await checkRpc(url, 8453)) bases.push(url);
            }
        });

        await Promise.all(checks);
    }
    
    console.log(`[RPC-MANAGER] Verified ${arbs.length}/15 Elite Arbitrum Nodes successfully.`);
    console.log(`[RPC-MANAGER] Verified ${bases.length}/15 Elite Base Nodes successfully.`);

    if (arbs.length === 0 && bases.length === 0) {
       console.log('[RPC-MANAGER] No viable keys located in entirety of vault. Quitting pipeline.');
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
    console.log('[RPC-MANAGER] Successfully injected capped targets into local .env registry.');

    // Fire synchronization event to perfectly push the configuration cleanly to active VPS
    console.log('[RPC-MANAGER] Exfiltrating payload through encrypted tunnel to VPS Execution Drone...');
    try {
        execSync('scp -i ~/.ssh/titan_droplet_key -o StrictHostKeyChecking=no .env root@134.122.5.13:/root/enterprise-arb-bot/.env', { stdio: 'inherit', cwd: require('path').resolve(__dirname, '..') });
        execSync('ssh -i ~/.ssh/titan_droplet_key -o StrictHostKeyChecking=no root@134.122.5.13 "cd /root/enterprise-arb-bot && npx pm2 restart all --update-env"', { stdio: 'inherit' });
        console.log('\n[RPC-MANAGER] Pipeline Bridge Complete. Drones are actively bounding limits natively!!!');
        console.log(`========================================\n`);
    } catch(e) {
        console.error('[RPC-MANAGER] Error orchestrating deploy proxy:', e.message);
    }
}

main();
