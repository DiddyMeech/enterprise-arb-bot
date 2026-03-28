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
echo "Standby Server bootstrapped securely" > /root/status.txt
`;

function createServer(name, type) {
    return new Promise((resolve, reject) => {
        const postData = JSON.stringify({
            name: name,
            server_type: type,
            location: "nbg1", // Try Nuremberg for availability
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

async function deployStandby() {
    console.log("Deploying Secondary Standby Node to Nuremberg (nbg1)...\n");
    let standby = await createServer("standby-arb-node", "cpx31");
    if (!standby) {
        console.log("\n[FALLBACK] Quota limits prevented cpx31. Deploying Intel cx32...");
        standby = await createServer("standby-arb-node", "cx32");
    }
}

deployStandby();
