#!/usr/bin/env node
/**
 * scripts/manual-live-trade.js
 *
 * One-shot manual wallet-mode trade for proving the live execution pipeline.
 *
 * Uses Native USDC (0xaf88...) → WETH → USDC via Sushi V2 on Arbitrum.
 *
 * Steps:
 *   1. Simulate the route (dry-run, no gas spent)
 *   2. If sim passes — approve executor to spend USDC
 *   3. Call executeArbitrage and wait for receipt
 *
 * Usage:
 *   node scripts/manual-live-trade.js [amountUSDC]
 *
 *   Default: 5 USDC
 *   Example: node scripts/manual-live-trade.js 10
 */

require('dotenv').config();
const { ethers } = require('ethers');
const config = require('@arb/config');
const {
  buildExecutionPlan,
  normalizeRoute,
  encodeDexLeg,
  decodeCommonRevert,
} = require('@arb/trade-decision-engine');

// ── Config ───────────────────────────────────────────────────────────────────
const USDC_NATIVE = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831'; // Native USDC
const WETH        = '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1';
const SUSHI       = '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506';
const CHAIN       = 'arbitrum';
const CHAIN_ID    = 42161;

const arbCfg = Object.values(config.CHAINS).find(c => c.name === CHAIN);
if (!arbCfg) throw new Error('No arbitrum config found');

const EXECUTOR = arbCfg.contractAddress || config.ARB_CONTRACT_ADDRESS;
if (!EXECUTOR) throw new Error('No executor contract address in config');

// Amount in USDC (6 decimals)
const amountUSDC   = process.argv[2] ? parseFloat(process.argv[2]) : 5;
const amountInRaw  = ethers.utils.parseUnits(String(amountUSDC), 6).toString();

async function main() {
  const provider = new ethers.providers.JsonRpcProvider(arbCfg.rpcs[0], { chainId: CHAIN_ID, name: CHAIN });
  const wallet   = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

  console.log('\n=== MANUAL LIVE TRADE ===');
  console.log('Wallet:  ', wallet.address);
  console.log('Executor:', EXECUTOR);
  console.log('Amount:  ', amountUSDC, 'USDC (Native)');
  console.log('Route:   ', 'USDC → WETH → USDC via Sushi');
  console.log('');

  // ── Balance check ──────────────────────────────────────────────────────────
  const usdcContract = new ethers.Contract(
    USDC_NATIVE,
    ['function balanceOf(address) view returns (uint256)', 'function approve(address,uint256) returns (bool)', 'function allowance(address,address) view returns (uint256)'],
    wallet
  );
  const usdcBal = await usdcContract.balanceOf(wallet.address);
  const ethBal  = await wallet.getBalance();

  console.log('Balances:');
  console.log('  USDC (native):', ethers.utils.formatUnits(usdcBal, 6));
  console.log('  ETH:          ', ethers.utils.formatEther(ethBal));

  if (usdcBal.lt(amountInRaw)) {
    throw new Error(`Insufficient USDC: have ${ethers.utils.formatUnits(usdcBal, 6)}, need ${amountUSDC}`);
  }

  // ── Build route ────────────────────────────────────────────────────────────
  const deadline = Math.floor(Date.now() / 1000) + 120;

  // Get live leg2 amountIn from Sushi
  const sushiIface = new ethers.utils.Interface([
    'function getAmountsOut(uint amountIn, address[] path) view returns (uint[] amounts)',
  ]);
  const sushiContract = new ethers.Contract(SUSHI, sushiIface, provider);
  let leg2AmountInRaw = amountInRaw;
  try {
    const amounts = await sushiContract.getAmountsOut(amountInRaw, [USDC_NATIVE, WETH]);
    leg2AmountInRaw = amounts[1].toString();
    console.log(`\nLeg 1 quote: ${amountUSDC} USDC → ${ethers.utils.formatEther(amounts[1])} WETH`);
  } catch (e) {
    console.warn('getAmountsOut failed, using raw fallback:', e.message);
  }

  const normalized = normalizeRoute({
    deadline,
    legs: [
      {
        dex: 'sushi', router: SUSHI,
        tokenIn: USDC_NATIVE, tokenOut: WETH,
        recipient: EXECUTOR, amountInRaw, minOutRaw: '1',
      },
      {
        dex: 'sushi', router: SUSHI,
        tokenIn: WETH, tokenOut: USDC_NATIVE,
        recipient: EXECUTOR, amountInRaw: leg2AmountInRaw, minOutRaw: '1',
      },
    ],
  });

  const encodedLegs = normalized.map(l => encodeDexLeg(l));
  const plan = buildExecutionPlan({
    executorAddress: EXECUTOR,
    mode: 'wallet',
    route: {
      chain: CHAIN,
      tokenIn: USDC_NATIVE,
      tokenOut: USDC_NATIVE,
      amountInRaw,
      minProfitTokenRaw: '0',
      minOutRaw: '1',
      deadline,
      legs: encodedLegs,
    },
  });

  console.log('\nRoute plan:');
  console.log('  selector:', plan.calldata.slice(0, 10));
  console.log('  legs:    ', encodedLegs.length);

  // ── Step 1: Simulate ───────────────────────────────────────────────────────
  console.log('\n[1/3] Simulating...');
  try {
    await provider.call({ to: plan.target, data: plan.calldata });
    console.log('  ✅ SIMULATION_OK — route is valid');
  } catch (err) {
    const reason = decodeCommonRevert(err);
    console.error('  ❌ SIMULATION_FAILED:', reason);
    console.error('  Aborting — not sending live tx');
    process.exit(2);
  }

  // ── Step 2: Approve ────────────────────────────────────────────────────────
  console.log('\n[2/3] Approving executor to spend USDC...');
  const allowance = await usdcContract.allowance(wallet.address, EXECUTOR);
  if (allowance.lt(amountInRaw)) {
    const approveTx = await usdcContract.approve(EXECUTOR, amountInRaw, {
      gasLimit: 100000,
    });
    console.log('  approve tx:', approveTx.hash);
    await approveTx.wait();
    console.log('  ✅ Approved');
  } else {
    console.log('  ✅ Already approved (allowance sufficient)');
  }

  // ── Step 3: Execute ────────────────────────────────────────────────────────
  console.log('\n[3/3] Sending executeArbitrage tx...');
  const gasEstimate = await provider.estimateGas({
    from: wallet.address,
    to: plan.target,
    data: plan.calldata,
  }).catch(() => ethers.BigNumber.from(800000));

  const gasPrice = await provider.getGasPrice();
  const gasCostEth = ethers.utils.formatEther(gasEstimate.mul(gasPrice));
  console.log(`  estimated gas: ${gasEstimate.toString()} units @ ${ethers.utils.formatUnits(gasPrice, 'gwei')} gwei = ${gasCostEth} ETH`);

  const nonce = await provider.getTransactionCount(wallet.address, 'pending');
  const tx = await wallet.sendTransaction({
    to: plan.target,
    data: plan.calldata,
    gasLimit: gasEstimate.mul(120).div(100), // +20% buffer
    nonce,
  });

  console.log('\n🚀 TX SENT:', tx.hash);
  console.log('  Waiting for confirmation...');

  const receipt = await tx.wait();
  if (receipt.status === 1) {
    console.log('\n✅ TRADE CONFIRMED');
    console.log('  Block:    ', receipt.blockNumber);
    console.log('  Gas used: ', receipt.gasUsed.toString());
    console.log('  Tx hash:  ', receipt.transactionHash);
    console.log('  Arbiscan: ', `https://arbiscan.io/tx/${receipt.transactionHash}`);
  } else {
    console.error('\n❌ TX REVERTED on-chain');
    console.error('  Tx hash:', receipt.transactionHash);
  }
}

main().catch(err => {
  console.error('\n[manual-live-trade] Error:', err.message);
  process.exit(1);
});
