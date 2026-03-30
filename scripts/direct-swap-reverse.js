#!/usr/bin/env node
/**
 * scripts/direct-swap-reverse.js
 *
 * Proves the reverse leg: WETH → USDC via Sushi V2 on Arbitrum.
 * Swaps ALL WETH in wallet back to USDC.
 *
 * Usage:
 *   node scripts/direct-swap-reverse.js
 */

require('dotenv').config();
const { ethers } = require('ethers');
const config = require('@arb/config');

const USDC_NATIVE = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
const WETH        = '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1';
const SUSHI       = '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506';
const CHAIN_ID    = 42161;

const ROUTER_ABI = [
  'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) external returns (uint256[] memory amounts)',
  'function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts)',
];
const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
  'function allowance(address,address) view returns (uint256)',
];

async function main() {
  const arbCfg  = Object.values(config.CHAINS).find(c => c.name === 'arbitrum');
  const provider = new ethers.providers.JsonRpcProvider(arbCfg.rpcs[0], { chainId: CHAIN_ID, name: 'arbitrum' });
  const wallet   = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  const weth     = new ethers.Contract(WETH, ERC20_ABI, wallet);
  const router   = new ethers.Contract(SUSHI, ROUTER_ABI, wallet);

  console.log('\n=== DIRECT SUSHI REVERSE SWAP ===');
  console.log('Wallet: ', wallet.address);
  console.log('Swap:   WETH → USDC via Sushi');

  const wethBal = await weth.balanceOf(wallet.address);
  const ethBal  = await wallet.getBalance();
  console.log('\nBalances:');
  console.log('  WETH:', ethers.utils.formatEther(wethBal));
  console.log('  ETH: ', ethers.utils.formatEther(ethBal));

  if (wethBal.isZero()) throw new Error('No WETH in wallet — run direct-swap.js first');

  const amounts    = await router.getAmountsOut(wethBal, [WETH, USDC_NATIVE]);
  const usdcOut    = amounts[1];
  const minUsdcOut = usdcOut.mul(99).div(100); // 1% slippage
  console.log(`\nQuote: ${ethers.utils.formatEther(wethBal)} WETH → ${ethers.utils.formatUnits(usdcOut, 6)} USDC`);
  console.log(`MinOut (1% slippage): ${ethers.utils.formatUnits(minUsdcOut, 6)} USDC`);

  // Approve Sushi to spend WETH
  const allowance = await weth.allowance(wallet.address, SUSHI);
  if (allowance.lt(wethBal)) {
    console.log('\nApproving Sushi to spend WETH...');
    const approveTx = await weth.approve(SUSHI, wethBal, { gasLimit: 100000 });
    console.log('  approve tx:', approveTx.hash);
    await approveTx.wait();
    console.log('  ✅ Approved');
  } else {
    console.log('\n✅ Sushi already approved for WETH');
  }

  const deadline = Math.floor(Date.now() / 1000) + 120;
  const nonce    = await provider.getTransactionCount(wallet.address, 'pending');
  const block    = await provider.getBlock('latest');
  const baseFee  = block.baseFeePerGas ?? ethers.BigNumber.from(0);
  const priority = ethers.utils.parseUnits('0.02', 'gwei');
  const maxFee   = baseFee.mul(2).add(priority);

  console.log(`\nSending reverse swap tx (nonce=${nonce}, baseFee=${ethers.utils.formatUnits(baseFee,'gwei')} maxFee=${ethers.utils.formatUnits(maxFee,'gwei')} gwei)...`);
  const tx = await router.swapExactTokensForTokens(
    wethBal, minUsdcOut,
    [WETH, USDC_NATIVE],
    wallet.address, deadline,
    { gasLimit: 800000, maxFeePerGas: maxFee, maxPriorityFeePerGas: priority, nonce }
  );

  console.log('🚀 TX SENT:', tx.hash);
  console.log('  Waiting for confirmation...');
  const receipt = await tx.wait();

  if (receipt.status === 1) {
    const newUsdc = await new ethers.Contract(USDC_NATIVE, ERC20_ABI, provider).balanceOf(wallet.address);
    console.log('\n✅ REVERSE SWAP CONFIRMED');
    console.log('  Block:    ', receipt.blockNumber);
    console.log('  Gas used: ', receipt.gasUsed.toString());
    console.log('  USDC bal: ', ethers.utils.formatUnits(newUsdc, 6));
    console.log('  Arbiscan: ', `https://arbiscan.io/tx/${receipt.transactionHash}`);
  } else {
    console.error('\n❌ REVERTED:', receipt.transactionHash);
  }
}

main().catch(err => {
  console.error('\n[direct-swap-reverse] Error:', err.message?.slice(0, 300));
  process.exit(1);
});
