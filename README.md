# Enterprise Multi-Chain Arbitrage System

An institutional-grade, self-improving multi-chain arbitrage system optimized for consistent low-risk routing.

## Architecture Configuration
The system operates as a unified `npm workspaces` monorepo:
- **Scanner**: Ingests DEX pools via BSC WebSockets or Arbitrum/Base aggressive parallel polling.
- **Simulator**: Strictly verifies route feasibility sequentially offline via `callStatic` against `$40` net profit bounds and pool age constraints. 
- **Executor**: Envelopes outputs with EIP-1559 gas mechanic bounds and routes concurrently through multi-RPC setups and MEV relay providers.
- **Learner Engine**: An ML-style recurrent daemon sweeping the `trades` and `failures` Postgres DBs to blacklist failing tokens and auto-update `strategy_metrics`.
- **Coordinator & Dashboard**: Node.js ecosystem supervision emitting standardized Prometheus metrics.
- **Engines**: Highly decoupled internal packages for Gas predictability (`gas-engine`), network anomaly mappings (`timing-engine`), and profit validation layers.

## Prerequisites
- Node.js (18+)
- Docker & Docker Compose

## Global Installation

1. **Bootstrap the Monorepo architecture:**
   ```bash
   npm install
   ```

2. **Supply Configuration Parameters:**
   Copy `.env.example` -> `.env`. Populate your array of WSS/RPC points and the Operator `PRIVATE_KEY`.

3. **Initialize the Infrastructure Stack (Postgres, Redis, Prometheus, Grafana):**
   ```bash
   cd infra
   docker-compose up -d
   ```

4. **Deploy the Base Execution Smart Contracts:**
   The base Phase 1 router logic resides natively in the `contracts/ArbitrageExecutor.sol` file without initially injecting Flash loans to enforce rigid capital controls. Deploy this locked box using Foundry against your target chains. Ensure you update `this.arbContractAddress` located in `@arb/tx-router` immediately post-deployment.

5. **Orchestrate the Microservices:**
   You can boot individual services natively tied to the workspace context hooks mapping directly from the root package loop:
   ```bash
   npm run start:scanner
   npm run start:simulator
   npm run start:executor
   npm run start:learner
   npm run start:coordinator
   npm run start:dashboard
   ```
   *For persistent scaling into production, map these start commands within a PM2 runtime ecosystem.*

## Database Integrations
The node utilizes a 4-table Postgres schema initialized from `infra/init.sql`. The `learner` process continuously analyzes `opportunities`, `trades`, and `failures` data incrementally every 24h. The optimization cycle identifies consistently failing honey-pot pools and automatically raises system flags bypassing them.
