#!/bin/bash
# Enterprise Arbitrage Execution Wrapper
echo "======================================"
echo "    Arbitrage Bot System Boots        "
echo "======================================"

echo "[1/2] 🐳 Booting Postgres, Redis, Prometheus, and Grafana..."
cd infra
docker compose up -d
cd ..

echo "[2/2] 🚀 Dispatching PM2 Microservices..."
# Ensure PM2 natively watches the background processes safely mapping autorestarts
npx pm2 start ecosystem.config.js

echo "======================================"
echo "✅ Operational Checklist Complete"
echo "System is currently rigged to execute in SAFE_MODE (Dry-Run bounds strictly enforced)."
echo ""
echo "Monitor real-time metrics and logs using:"
echo "npx pm2 logs"
echo "npx pm2 monit"
echo "======================================"
