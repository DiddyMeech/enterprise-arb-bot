#!/bin/bash
echo -e "\n\033[1;35m[!!!] TITAN 3.0 INFINITE AUTONOMOUS ORCHESTRATOR INITIATED [!!!]\033[0m"

while true; do
    echo -e "\n\033[1;36m[+] PHASE 1: Launching Headless Swarm Reconnaissance...\033[0m"
    cd /home/meech/Desktop/enterprise-arb-bot/titan_auto_hunter
    ./titan_auto_hunter -auto-web3
    
    echo -e "\n\033[1;36m[+] PHASE 2: Ingesting & Validating Harvested Web3 Endpoints...\033[0m"
    cd /home/meech/Desktop/enterprise-arb-bot
    node scripts/update-rpcs.js
    
    echo -e "\n\033[1;36m[+] PHASE 3: Pushing Live Validated Configurations & Hot-Reloading PM2 Cloud Cluster...\033[0m"
    # Sync the generated .env directly to the live droplet
    scp -i ~/.ssh/titan_droplet_key -o StrictHostKeyChecking=no /home/meech/Desktop/enterprise-arb-bot/.env root@134.122.5.13:/root/enterprise-arb-bot/.env
    # Reload the PM2 process gracefully without dropping queued transactions
    ssh -i ~/.ssh/titan_droplet_key -o StrictHostKeyChecking=no root@134.122.5.13 "cd /root/enterprise-arb-bot && pm2 reload arb-scanner"
    
    echo -e "\n\033[1;32m[+] CYCLE COMPLETE. Ecosystem successfully synchronized. Sleeping for 60 minutes...\033[0m"
    sleep 3600
done
