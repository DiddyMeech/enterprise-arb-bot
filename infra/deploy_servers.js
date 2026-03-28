const https = require('https');

// Utilizing Token index 2 (G5CCO...) as it successfully authenticated and currently has 0 servers mapped out.
const TOKEN = "G5CCO9M8ByDAPymfULHcJuMTwfgyTmjUP53cNk3APh4CpvNbQlVz2a69yMmyDMH0"; 

const cloudInit = `#!/bin/bash
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y docker.io docker-compose git ufw nodejs npm
systemctl enable docker
systemctl start docker
ufw allow 22/tcp
ufw --force enable

# Prepare the enterprise arb workspace directory structure securely
mkdir -p /opt/arbitrage-bot
echo "Server bootstrapped and secured for Enterprise Arb Bot Execution" > /root/status.txt
`;

function createServer(name, type) {
    return new Promise((resolve, reject) => {
        const postData = JSON.stringify({
            name: name,
            server_type: type,
            location: "fsn1", // Falkenstein, Germany per Hetzner datacenter parks
            image: "ubuntu-24.04",
            user_data: cloudInit
        });

        const req = https.request('https://api.hetzner.cloud/v1/servers', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${TOKEN}`,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode === 201) {
                    const parsed = JSON.parse(data);
                    console.log(`[SUCCESS] Provisioned ${name} (${type}) at IPv4: ${parsed.server.public_net.ipv4.ip}`);
                    resolve(parsed);
                } else {
                    console.error(`[FAILED] Could not provision ${name} (${type}): HTTP ${res.statusCode} -> ${data}`);
                    resolve(null);
                }
            });
        });

        req.on('error', reject);
        req.write(postData);
        req.end();
    });
}

async function deployCluster() {
    console.log("Initiating Enterprise Hetzner Cluster Deployment...\n");
    
    // Spin up the Primary Trading Executor
    // Attempting `ccx33` (Dedicated vCPU, High-Freq AMD EPYC, 8 Cores, 32GB RAM). 
    // Usually the max standard deployment without specific custom solutions manual ticket overrides.
    let primary = await createServer("primary-arb-node", "ccx33");
    if (!primary) {
        console.log("\n[FALLBACK] Quota limits prevented ccx33. Deploying cpx51 (16 Cores, 32GB RAM)...");
        primary = await createServer("primary-arb-node", "cpx51");
    }

    // Spin up the Secondary Standby Node mapped to smaller tier for state redundancies.
    let standby = await createServer("standby-arb-node", "cpx31");
    
    console.log("\nCluster deployment dispatch complete.");
}

deployCluster();
