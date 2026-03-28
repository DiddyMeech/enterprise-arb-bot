const https = require('https');
const TOKEN = "G5CCO9M8ByDAPymfULHcJuMTwfgyTmjUP53cNk3APh4CpvNbQlVz2a69yMmyDMH0"; 

const cloudInit = `#!/bin/bash
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y docker.io docker-compose git ufw nodejs npm
systemctl enable docker
systemctl start docker
ufw allow 22/tcp
ufw --force enable
mkdir -p /opt/arbitrage-bot
echo "Backup Server bootstrapped and secured" > /root/status.txt
`;

function request(method, path, data = null) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'api.hetzner.cloud',
            path: path,
            method: method,
            headers: {
                'Authorization': `Bearer ${TOKEN}`,
                'Content-Type': 'application/json'
            }
        };

        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => resolve(JSON.parse(body)));
        });

        req.on('error', reject);
        if (data) req.write(JSON.stringify(data));
        req.end();
    });
}

async function exec() {
    try {
        console.log("Fetching securely integrated SSH key from Token Project...");
        const keysRes = await request('GET', '/v1/ssh_keys');
        const key = keysRes.ssh_keys.find(k => k.name === "meech-key");
        if (!key) throw new Error("SSH Key 'meech-key' not found. Ensure primary was deployed successfully.");

        // We will rotate through locations providing geographic resilience (Helsinki -> Ashburn -> Falkenstein)
        const locations = ["hel1", "ash", "fsn1"]; 
        const types = ["cpx31", "cpx21", "cx31", "ccx23"]; // CPU robust fallbacks for the hot-standby node
        
        let success = false;
        
        for (const loc of locations) {
            for (const type of types) {
                if (success) break;
                console.log(`[ATTEMPT] Provisioning backup-arb-node (${type}) in region ${loc}...`);
                
                const res = await request('POST', '/v1/servers', {
                    name: "backup-arb-node",
                    server_type: type,
                    location: loc,
                    image: "ubuntu-24.04",
                    ssh_keys: [key.id],
                    user_data: cloudInit
                });
                
                if (res.server) {
                    console.log(`[SUCCESS] Booted backup-arb-node! Location: ${loc}, Tier: ${type}, IPv4: ${res.server.public_net.ipv4.ip}`);
                    success = true;
                } else if (res.error) {
                    console.log(`  -> [FAILED] Reason: ${res.error.message}`);
                }
                
                // Small sleep bypass to ensure no rapid HTTP API bans
                await new Promise(r => setTimeout(r, 2000));
            }
        }
        
        if (!success) {
            console.error("Exhausted all fallback locations/types for backup node matching this Token's quota.");
        }
    } catch(e) {
        console.error("FATAL ERROR:", e.message);
    }
}
exec();
