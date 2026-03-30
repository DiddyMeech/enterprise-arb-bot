#!/usr/bin/env node
/**
 * scripts/direct-swap.js
 *
 * Proves live execution pipeline by doing a direct single-leg wallet swap:
 *   USDC (Native) → WETH via Sushi V2 on Arbitrum
 *
 * Bypasses the executor contract entirely — calls Sushi router directly.
 * This is the fastest way to confirm the wallet can sign and broadcast real txs.
 *
 * Usage:
 *   node scripts/direct-swap.js [amountUSDC]
 *   Default: 3 USDC
 */

require('dotenv').config();
const { ethers } = require('ethers');
const config = require('@arb/config');

const USDC_NATIVE = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
const WETH        = '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1';
const SUSHI       = '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506';
const CHAIN_ID    = 42161;

const SUSHI_ABI = [
  'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) external returns (uint256[] memory amounts)',
  'function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts)',
];
const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
  'function allowance(address,address) view returns (uint256)',
];

const amountUSDC  = process.argv[2] ? parseFloat(process.argv[2]) : 3;
const amountInRaw = ethers.utils.parseUnits(String(amountUSDC), 6);

async function main() {
  const arbCfg   = Object.values(config.CHAINS).find(c => c.name === 'arbitrum');
  const provider  = new ethers.providers.JsonRpcProvider(arbCfg.rpcs[0], { chainId: CHAIN_ID, name: 'arbitrum' });
  const wallet    = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  const usdc      = new ethers.Contract(USDC_NATIVE, ERC20_ABI, wallet);
  const router    = new ethers.Contract(SUSHI, SUSHI_ABI, wallet);

  console.log('\n=== DIRECT SUSHI SWAP ===');
  console.log('Wallet:  ', wallet.address);
  console.log('Swap:    ', `${amountUSDC} USDC → WETH via Sushi`);

  // ── Balances ──────────────────────────────────────────────────────────────
  const usdcBal = await usdc.balanceOf(wallet.address);
  const ethBal  = await wallet.getBalance();
  console.log('\nBalances:');
  console.log('  USDC:', ethers.utils.formatUnits(usdcBal, 6));
  console.log('  ETH: ', ethers.utils.formatEther(ethBal));
  if (usdcBal.lt(amountInRaw)) throw new Error(`Need ${amountUSDC} USDC, have ${ethers.utils.formatUnits(usdcBal, 6)}`);

  // ── Quote ─────────────────────────────────────────────────────────────────
  const amounts    = await router.getAmountsOut(amountInRaw, [USDC_NATIVE, WETH]);
  const wethOut    = amounts[1];
  const minWethOut = wethOut.mul(99).div(100); // 1% slippage
  console.log(`\nQuote: ${amountUSDC} USDC → ${ethers.utils.formatEther(wethOut)} WETH`);
  console.log(`MinOut (1% slippage): ${ethers.utils.formatEther(minWethOut)} WETH`);

  // ── Approve ───────────────────────────────────────────────────────────────
  const allowance = await usdc.allowance(wallet.address, SUSHI);
  if (allowance.lt(amountInRaw)) {
    console.log('\nApproving Sushi to spend USDC...');
    const approveTx = await usdc.approve(SUSHI, amountInRaw, { gasLimit: 100000 });
    console.log('  approve tx:', approveTx.hash);
    await approveTx.wait();
    console.log('  ✅ Approved');
  } else {
    console.log('\n✅ Sushi already approved');
  }

  // ── Swap ──────────────────────────────────────────────────────────────────
  const deadline = Math.floor(Date.now() / 1000) + 120;
  const nonce    = await provider.getTransactionCount(wallet.address, 'pending');
  const gasPrice = await provider.getGasPrice();

  console.log(`\nSending swap tx (nonce=${nonce})...`);
  const tx = await router.swapExactTokensForTokens(
    amountInRaw,
    minWethOut,
    [USDC_NATIVE, WETH],
    wallet.address,
    deadline,
    { gasLimit: 300000, gasPrice, nonce }
  );

  console.log('🚀 TX SENT:', tx.hash);
  console.log('  Waiting for confirmation...');
  const receipt = await tx.wait();

  if (receipt.status === 1) {
    const newWethBal = await new ethers.Contract(WETH, ERC20_ABI, provider).balanceOf(wallet.address);
    console.log('\n✅ SWAP CONFIRMED');
    console.log('  Block:     ', receipt.blockNumber);
    console.log('  Gas used:  ', receipt.gasUsed.toString());
    console.log('  New WETH:  ', ethers.utils.formatEther(newWethBal));
    console.log('  Arbiscan:  ', `https://arbiscan.io/tx/${receipt.transactionHash}`);
  } else {
    console.error('\n❌ SWAP REVERTED');
    console.error('  Tx hash:', receipt.transactionHash);
    console.error('  Arbiscan:', `https://arbiscan.io/tx/${receipt.transactionHash}`);
  }
}

main().catch(err => {
  console.error('\n[direct-swap] Error:', err.message?.slice(0, 300));
  process.exit(1);
});
