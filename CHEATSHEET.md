# Titan 2.0 Operational Cheatsheet

This document serves as the master command references for operating, monitoring, and debugging the remote institutional execution droplet.

## 1. Connecting to the Server (SSH)
The architecture lives entirely on the remote Linux Execution Drone (`134.122.5.13`). 
Execute this from your laptop terminal to establish a secure root tunnel:
```bash
ssh -i ~/.ssh/titan_droplet_key -o StrictHostKeyChecking=no root@134.122.5.13
```
Once connected, navigate to the active workspace folder:
```bash
cd /root/enterprise-arb-bot
```

## 2. Managing the Ecosystem (PM2)
The ecosystem leverages PM2 to keep all 9 arbitrage modules (Scanner, Overseer, Executor, etc.) alive infinitely in the background.

*Run these commands from inside the `/root/enterprise-arb-bot` directory on the VPS:*

**View the Dashboard GUI (Highest Level Monitoring)**
```bash
npx pm2 monit
```

**View All Running Modules & RAM Usage**
```bash
npx pm2 status
```

**View Live Streaming Logs for a Specific Module**
```bash
npx pm2 logs arb-scanner       # See target discovery & heartbeat
npx pm2 logs arb-executor      # See simulated flashes and reverted gas estimates
npx pm2 logs arb-overseer      # See the AI adjusting risk floors and DB pruning
```

**Restart the Entire Ecosystem (Applies .env Updates)**
```bash
npx pm2 restart all --update-env
```

**Hard Reload the Ecosystem (Zero Downtime)**
```bash
npx pm2 reload all
```

## 3. Dynamic Node Automation
You do NOT need to SSH into the server to push new API proxy hits. Everything is handled locally from your laptop.

When your cracking tools drop new `VALID_HITS.md` or text files in your `/brain/loot_and_logs/` folder, completely load them up into rotation by typing this on your **LOCAL LAPTOP TERMINAL**:
```bash
cd ~/Desktop/Titan-main/enterprise-arb-bot
node scripts/update-rpcs.js
```
The drone script will actively test *every single file* in the vault, grab exactly **15** live working endpoints per chain, inject them into the `.env`, and automatically coordinate an SSH pipeline restart with the VPS directly.
