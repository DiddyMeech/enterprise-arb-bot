const https = require('https');

const TOKEN = "G5CCO9M8ByDAPymfULHcJuMTwfgyTmjUP53cNk3APh4CpvNbQlVz2a69yMmyDMH0"; 
const pubKey = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFJKLk+S7IplbxiwdI8oDPXuwRUZLKXpwrep1WZMwu5j 207982270+DiddyMeech@users.noreply.github.com";

const cloudInit = `#!/bin/bash
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y docker.io docker-compose git ufw nodejs npm
systemctl enable docker
systemctl start docker
ufw allow 22/tcp
ufw --force enable
mkdir -p /opt/arbitrage-bot
echo "Server bootstrapped and secured for Enterprise Arb Bot Execution" > /root/status.txt
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
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve(body ? JSON.parse(body) : null);
                } else {
                    reject(new Error(`HTTP ${res.statusCode}: ${body}`));
                }
            });
        });

        req.on('error', reject);
        if (data) req.write(JSON.stringify(data));
        req.end();
    });
}

async function exec() {
    try {
        console.log("1. Setting up SSH Key payload on the Hetzner Project via API...");
        let keyId;
        try {
            const keyRes = await request('POST', '/v1/ssh_keys', {
                name: "meech-key",
                public_key: pubKey
            });
            keyId = keyRes.ssh_key.id;
            console.log(`[SUCCESS] Uploaded local SSH Key: ${keyId}`);
        } catch (e) {
            if (e.message.includes("uniqueness_error")) {
                const keys = await request('GET', '/v1/ssh_keys');
                const matchingKey = keys.ssh_keys.find(k => k.name === "meech-key");
                keyId = matchingKey.id;
                console.log(`[FOUND] Using existing securely linked SSH Key: ${keyId}`);
            } else {
                throw e;
            }
        }

        console.log("2. Scanning for isolated primary-arb-node...");
        const serversRes = await request('GET', '/v1/servers');
        const existingNode = serversRes.servers.find(s => s.name === "primary-arb-node");

        if (existingNode) {
            console.log(`[FOUND] Scrapping previously locked execution server ID ${existingNode.id}...`);
            await request('DELETE', `/v1/servers/${existingNode.id}`);
            console.log("[SUCCESS] Node detached and deleted securely.");
            await new Promise(r => setTimeout(r, 6000)); // Sleep to allow global Hetzner routing purge
        }

        console.log("3. Provisioning the new Primary Arbitrage Node with injected SSH Key payloads...");
        
        let createRes;
        try {
            createRes = await request('POST', '/v1/servers', {
                name: "primary-arb-node",
                server_type: "ccx33",
                location: "fsn1",
                image: "ubuntu-24.04",
                ssh_keys: [keyId], // Injecting passwordless access
                user_data: cloudInit
            });
        } catch (e) {
            console.log("\n[FALLBACK] Strict Quota locks forced fallback to Intel CPX mapping");
            createRes = await request('POST', '/v1/servers', {
                name: "primary-arb-node",
                server_type: "cpx51",
                location: "fsn1",
                image: "ubuntu-24.04",
                ssh_keys: [keyId], 
                user_data: cloudInit
            });
        }

        console.log(`[SUCCESS] Booted primary-arb-node globally. IPv4 Target Bound: ${createRes.server.public_net.ipv4.ip}`);
        
    } catch(err) {
        console.error("FATAL AUTOMATION ERROR:", err.message);
    }
}

exec();
