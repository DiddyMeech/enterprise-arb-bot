# enterprise-arb-bot

Arbitrum-first DEX arbitrage bot with:
- scanner
- quote engine
- simulator
- standard executor
- Aave V3 flash-loan executor
- premium RPC lane management

## Current flow

### Quote / detect
`apps/scanner/index.js`
- uses quote RPC lane
- scans for cross-DEX USDC/WETH opportunities
- normalizes route objects

### Simulate
`apps/simulator/index.js`
- uses sim RPC lane
- rebuilds and validates route execution data
- supports standard and flash execution plans

### Execute
`apps/executor/index.js`
- uses send RPC lane
- sends either:
  - standard executor tx
  - Aave flash-loan tx

## Flash-loan path

Flash execution uses:
- `contracts/TitanArbitrageExecutor.sol`
- Aave V3 `flashLoanSimple`
- structured flash route params
- per-leg router/token allowlists
- V2 and V3 leg support

## Required environment variables

See `.env.example`.

At minimum set:
- `PRIVATE_KEY`
- `AAVE_POOL_ADDRESSES_PROVIDER`
- `ARB_FLASH_EXECUTOR_ADDRESS`
- premium Arbitrum RPC URLs
- `FLASH_LOAN_ENABLED=true`

## Deployment

Compile:
```bash
npx hardhat compile
```

Deploy flash executor:

```bash
npm run deploy:flash
```

Whitelist routers and tokens:

```bash
npm run whitelist:flash
```

Dry-run flash simulation:

```bash
npm run dryrun:flash
```

## Live validation order

1. compile
2. deploy flash executor
3. whitelist tokens and routers
4. run dry-run simulation
5. run one tiny live validation trade
6. inspect on-chain receipt before increasing size

## Notes

* Start tiny.
* Keep `SAFE_MODE=true` until dry-run passes.
* Use premium RPCs only for send lane.
* Do not scale until the first live flash-loan trade succeeds end-to-end.
