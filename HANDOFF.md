# TITAN 2.0: INSTITUTIONAL ARBITRAGE PIPELINE
**Author:** Antigravity Agent (EVM Validation & Routing Architecture)
**Date:** March 29, 2026
**Target Architecture:** Multi-Chain MEV (Base, Arbitrum)

## 1. Current State & Infrastructure
We are currently operating at **Phase 14**: Exact EVM Execution Alignment. The overarching pipeline is fully migrated to a robust TypeScript build ecosystem to eliminate simulation/execution divergence.
The theoretical simulator has been stripped away. Native `eth_call` validation confirms precise selector matches before executing any live transactions on the cloud nodes.

- **Cloud Node:** DigitalOcean Droplet (IP: `134.122.5.13`) synced directly from the local workspace via SSH `rsync` tunnel.
- **Execution Manager:** `pm2` actively maps the node ecosystem and is heavily engaged in high-frequency Arbitrum & Base mempool polling (`1000ms` intervals).
- **Security:** `.env` keys remain scrubbed and `VALID_HITS.md` credentials remain permanently GPG-encrypted.

## 2. Core Modifications Made (Phase 13 -> 14)
### A. Deterministic Calldata Generation
- **Canonical Routing:** Added `calldata-builder.ts` which forms a rigid `BuiltExecutionPlan` (targets, payloads, values, gasLimit) parsed simultaneously by the simulator and executor.
- **DEX Encoders:** Implemented specific routers under `packages/trade-decision-engine/src/dex-encoders/` for `UniV3`, `Sushi`, `Aerodrome`, and `Camelot`.
- **Selector Alignment:** `executor-abi.ts` acts as the definitive schema verifying exact Solidity byte signatures (`executeArbitrage` / `executeFlashArbitrage`).

### B. The EVM Execution Sandbox (Simulator)
- **Precise Debugging:** Hooked `sim-debug.ts` directly into the evaluation pipeline. If `callStatic` fails during pre-execution, the agent receives explicit `Error()` or `Panic()` traces parsed straight from the EVM buffer instead of vagueries.
- **Smoke Tested & Verified:** The scripts `verify-executor-selectors.js` and `known-good-route-smoke-test.js` were injected into `package.json`. Single-leg live Arbitrum simulations successfully map to `SIMULATION_OK`.

### C. Live Environment Diagnostics
- **RPC Resiliency:** Re-engineered `packages/config/index.js` to structure precise cross-chain RPC arrays. Restored the native `pollingInterval` parameter, terminating an aggressive silent-exit loop within `arb-scanner` on the live VPS.

## 3. Immediate Next Steps For Next Agent
The absolute next step is to progressively stretch the verified `SIMULATION_OK` paths out of the smoke tests and into the live memory queue:
1. **Two-Leg Smoke Tests:** Compose and pass a hardcoded two-leg swap sequence.
2. **Scanner Integrations:** Pipe the live scanner-fed permutations directly through the normalized encoded paths and verify them via `callStatic`.
3. **Flash Mode:** Once wallet-mode passes cleanly across the array, wire the uncollateralized loan parameters (Flashbots / Aave) into the simulation payload.
4. **ABI Struct Tweaks:** Be prepared to instantly modify the individual DEX encoders (e.g. `sushi.ts`) if specific routers throw `INSUFFICIENT_OUTPUT_AMOUNT` or payload mismatches during the tests.

## 4. The 10-Node MEV Swarm Matrix
*(Legacy Planning Document Retained Below)*
| Node ID | Droplet Spec | Target Ecosystems | Target DEXs | Required API / RPCs |
|---------|--------------|-------------------|-------------|---------------------|
| **Node 1 (ACTIVE)** | `4 vCPU / 8GB RAM` | Base, Arbitrum, Optimism | Uniswap V3, SushiSwap | Infura Elite (ETH L2s) |
| **Node 2** | `4 vCPU / 8GB RAM` | Polygon, Avalanche, BSC | PancakeSwap, TraderJoe, QuickSwap | QuickNode (AVAX/BSC), Alchemy (MATIC) |
| **Node 3** | `4 vCPU / 8GB RAM` | Solana (Rust VM) | Raydium, Orca, Jupiter | Helius RPC, QuickNode Solana Core |
| **Node 4** | `8 vCPU / 16GB RAM` | Ethereum Mainnet (L1) | Uniswap V2/V3, Curve | Alchemy Supernode, Flashbots Builder API |
| **Node 5** | `4 vCPU / 8GB RAM` | Fantom, Cronos | SpookySwap, VVS Finance | QuickNode (FTM/CRO) |
| **Node 6** | `4 vCPU / 8GB RAM` | Celo, Linea | Ubeswap, SyncSwap | Infura (Linea), QuickNode (Celo) |
| **Node 7** | `4 vCPU / 8GB RAM` | SUI, Aptos (Move VM) | Cetus, LiquidSwap | NodeReal RPC, Extrnode |
| **Node 8** | `4 vCPU / 8GB RAM` | zkSync Era, Scroll | SyncSwap, Ambient | Alchemy (zkSync) |
| **Node 9** | `8 vCPU / 16GB RAM` | Global CEX/DEX Arbitrage | Binance, Coinbase vs Dex | Binance API, Coinbase Pro API, CCXT |
| **Node 10** | `4 vCPU / 8GB RAM` | Master AI / Postgres DB | *Global Aggregation Engine* | Anthropic/OpenAI API, Master Postgres DB |
