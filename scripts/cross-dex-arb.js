#!/usr/bin/env node
/**
 * scripts/cross-dex-arb.js
 *
 * Live cross-DEX arb executor: Sushi ↔ UniV3 USDC/WETH on Arbitrum.
 *
 * Pre-broadcast profitability gate:
 *   1. Quote leg 1 (buy on cheapDex)
 *   2. Quote leg 2 (sell on expensiveDex)
 *   3. Compute gross profit, gas cost, net profit
 *   4. SKIP if net <= MIN_NET_PROFIT_USD
 *   5. Send only cross-DEX routes (dexBuy !== dexSell enforced)
 *   6. Log realized PnL after receipt
 *
 * Usage:
 *   node scripts/cross-dex-arb.js [amountUSDC]
 *   Default: 5 USDC
 */

require('dotenv').config();
const { ethers } = require('ethers');
const config = require('@arb/config');

// ── Constants ────────────────────────────────────────────────────────────────
const USDC         = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831'; // Native USDC
const WETH         = '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1';
const SUSHI        = '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506';
const UNIV3_QUOTER = '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6'; // QuoterV1
const UNIV3_ROUTER = '0xE592427A0AEce92De3Edee1F18E0157C05861564'; // SwapRouter
const POOL_FEE     = 500; // 0.05%
const CHAIN_ID     = 42161;

const ETH_USD_HINT      = 2200;     // rough ETH price for gas calc
const GAS_UNITS_APPROX  = 200_000;  // ~2-leg cross-DEX arb
const MIN_NET_PROFIT_USD = 1.00;    // skip if net < $1

const amountUSDC  = process.argv[2] ? parseFloat(process.argv[2]) : 5;
const amountInRaw = ethers.utils.parseUnits(String(amountUSDC), 6);

// ── ABIs ─────────────────────────────────────────────────────────────────────
const SUSHI_ABI = [
  'function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory)',
  'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) external returns (uint256[] memory)',
];
const UNIV3_QUOTER_ABI = [
  'function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external returns (uint256 amountOut)',
];
const UNIV3_ROUTER_ABI = [
  'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external returns (uint256)',
];
const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
  'function allowance(address,address) view returns (uint256)',
];

// ── Gas helpers ───────────────────────────────────────────────────────────────
async function getGasOverrides(provider) {
  const block    = await provider.getBlock('latest');
  const baseFee  = block.baseFeePerGas ?? ethers.BigNumber.from(0);
  const priority = ethers.utils.parseUnits('0.02', 'gwei');
  const maxFee   = baseFee.mul(2).add(priority);
  return { maxFeePerGas: maxFee, maxPriorityFeePerGas: priority };
}

function gasUsd(gasPrice) {
  const gasCostEth = parseFloat(ethers.utils.formatEther(gasPrice.mul(GAS_UNITS_APPROX)));
  return gasCostEth * ETH_USD_HINT;
}

// ── Approve helper ────────────────────────────────────────────────────────────
async function ensureApproved(tokenContract, spender, amount, wallet) {
  const allowed = await tokenContract.allowance(wallet.address, spender);
  if (allowed.lt(amount)) {
    console.log(`  Approving ${spender.slice(0,10)}...`);
    const tx = await tokenContract.approve(spender, amount, { gasLimit: 100000 });
    await tx.wait();
    console.log('  ✅ Approved');
  }
}

async function main() {
  const arbCfg  = Object.values(config.CHAINS).find(c => c.name === 'arbitrum');
  const provider = new ethers.providers.JsonRpcProvider(arbCfg.rpcs[0], { chainId: CHAIN_ID, name: 'arbitrum' });
  const wallet   = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

  const sushi    = new ethers.Contract(SUSHI, SUSHI_ABI, wallet);
  const quoter   = new ethers.Contract(UNIV3_QUOTER, UNIV3_QUOTER_ABI, provider);
  const usdcC    = new ethers.Contract(USDC, ERC20_ABI, wallet);

  console.log('\n=== CROSS-DEX ARB SCANNER ===');
  console.log('Wallet:  ', wallet.address);
  console.log('Amount:  ', amountUSDC, 'USDC');
  console.log('Pair:    USDC/WETH | Sushi ↔ UniV3');
  console.log('MinNet: $', MIN_NET_PROFIT_USD);

  // ── Step 1: Quote both DEXes ───────────────────────────────────────────────
  const [sushiAmounts, univ3Out] = await Promise.all([
    sushi.getAmountsOut(amountInRaw, [USDC, WETH]),
    quoter.callStatic.quoteExactInputSingle(USDC, WETH, POOL_FEE, amountInRaw, 0),
  ]);
  const sushiWethOut = sushiAmounts[1];
  const univ3WethOut = univ3Out;

  const sushiPrice = parseFloat(ethers.utils.formatEther(sushiWethOut)) / amountUSDC;
  const univ3Price = parseFloat(ethers.utils.formatEther(univ3WethOut)) / amountUSDC;

  console.log('\n── Price Quotes ──');
  console.log(`  Sushi:  ${ethers.utils.formatEther(sushiWethOut)} WETH (${(1/sushiPrice).toFixed(2)} USDC/ETH)`);
  console.log(`  UniV3:  ${ethers.utils.formatEther(univ3WethOut)} WETH (${(1/univ3Price).toFixed(2)} USDC/ETH)`);

  // ── Step 2: Determine direction ────────────────────────────────────────────
  // Buy on the DEX that gives MORE WETH per USDC (cheaper WETH), sell on the other
  const buyOnSushi   = sushiWethOut.gt(univ3WethOut); // Sushi gives more WETH → cheaper → buy there
  const wethBuyOut   = buyOnSushi ? sushiWethOut : univ3WethOut;  // actual WETH we'd receive on buy leg
  const minWethOut   = buyOnSushi ? univ3WethOut : sushiWethOut;  // the 'expensive' DEX output
  const div = minWethOut.gt(0)
    ? parseFloat(ethers.utils.formatEther(wethBuyOut.sub(minWethOut).abs())) / parseFloat(ethers.utils.formatEther(minWethOut)) * 10000
    : 0;

  console.log(`\n  Divergence: ${div.toFixed(1)} bps | Buy on: ${buyOnSushi ? 'Sushi' : 'UniV3'} (more WETH out)`);

  // ── Step 3: Quote leg 2 (sell side) using actual weth from buy leg ──────────
  const wethToSell = wethBuyOut;
  let finalUsdcOut;

  if (buyOnSushi) {
    // Bought WETH on Sushi → sell on UniV3
    const sellOut = await quoter.callStatic.quoteExactInputSingle(WETH, USDC, POOL_FEE, wethToSell, 0);
    finalUsdcOut = parseFloat(ethers.utils.formatUnits(sellOut, 6));
    console.log(`  Leg 2 (UniV3 sell): ${ethers.utils.formatEther(wethToSell)} WETH → ${finalUsdcOut.toFixed(6)} USDC`);
  } else {
    // Bought WETH on UniV3 → sell on Sushi
    const sellAmounts = await sushi.getAmountsOut(wethToSell, [WETH, USDC]);
    finalUsdcOut = parseFloat(ethers.utils.formatUnits(sellAmounts[1], 6));
    console.log(`  Leg 2 (Sushi sell): ${ethers.utils.formatEther(wethToSell)} WETH → ${finalUsdcOut.toFixed(6)} USDC`);
  }

  // ── Step 4: Profitability gate ─────────────────────────────────────────────
  const overrides   = await getGasOverrides(provider);
  const gasCostUsd  = gasUsd(overrides.maxFeePerGas);
  const grossProfit = finalUsdcOut - amountUSDC;
  const netProfit   = grossProfit - gasCostUsd;

  console.log('\n── Profitability ──');
  console.log(`  Input:      $${amountUSDC.toFixed(6)} USDC`);
  console.log(`  Output:     $${finalUsdcOut.toFixed(6)} USDC`);
  console.log(`  Gross:      $${grossProfit.toFixed(6)}`);
  console.log(`  Gas est:   ~$${gasCostUsd.toFixed(4)}`);
  console.log(`  Net:        $${netProfit.toFixed(6)}`);

  if (grossProfit <= 0) {
    console.log('\n⚠️  SKIP — same-DEX/no-spread (gross <= 0). Market is efficient right now.');
    return;
  }
  if (netProfit < MIN_NET_PROFIT_USD) {
    console.log(`\n⚠️  SKIP — net $${netProfit.toFixed(4)} < threshold $${MIN_NET_PROFIT_USD}. Not profitable after gas.`);
    return;
  }

  console.log(`\n🟢 PROFITABLE — sending cross-DEX arb (buy on ${buyOnSushi ? 'Sushi' : 'UniV3'}, sell on ${buyOnSushi ? 'UniV3' : 'Sushi'})...`);

  // ── Step 5: Execute ────────────────────────────────────────────────────────
  const deadline  = Math.floor(Date.now() / 1000) + 120;
  const nonce     = await provider.getTransactionCount(wallet.address, 'pending');
  const startBal  = await usdcC.balanceOf(wallet.address);
  let   finalBal;
  let   receipt;

  if (buyOnSushi) {
    // Leg 1: Sushi USDC→WETH
    await ensureApproved(usdcC, SUSHI, amountInRaw, wallet);
    const slipMin = sushiWethOut.mul(99).div(100);
    const tx1 = await sushi.swapExactTokensForTokens(amountInRaw, slipMin, [USDC, WETH], wallet.address, deadline,
      { gasLimit: 400000, ...overrides, nonce });
    console.log('  Leg 1 tx:', tx1.hash);
    receipt = await tx1.wait();
    const wethBal = await new ethers.Contract(WETH, ERC20_ABI, provider).balanceOf(wallet.address);

    // Leg 2: UniV3 WETH→USDC
    const wethC = new ethers.Contract(WETH, ERC20_ABI, wallet);
    await ensureApproved(wethC, UNIV3_ROUTER, wethBal, wallet);
    const uniRouter = new ethers.Contract(UNIV3_ROUTER, UNIV3_ROUTER_ABI, wallet);
    const slipMin2 = univ3WethOut.mul(99).div(100);
    const nonce2 = await provider.getTransactionCount(wallet.address, 'pending');
    const overrides2 = await getGasOverrides(provider);
    const tx2 = await uniRouter.exactInputSingle(
      { tokenIn: WETH, tokenOut: USDC, fee: POOL_FEE, recipient: wallet.address, deadline, amountIn: wethBal, amountOutMinimum: slipMin2, sqrtPriceLimitX96: 0 },
      { gasLimit: 400000, ...overrides2, nonce: nonce2 }
    );
    console.log('  Leg 2 tx:', tx2.hash);
    const receipt2 = await tx2.wait();
    finalBal = await usdcC.balanceOf(wallet.address);
    console.log('  Arbiscan leg 1:', `https://arbiscan.io/tx/${receipt.transactionHash}`);
    console.log('  Arbiscan leg 2:', `https://arbiscan.io/tx/${receipt2.transactionHash}`);
  } else {
    // Leg 1: UniV3 USDC→WETH
    await ensureApproved(usdcC, UNIV3_ROUTER, amountInRaw, wallet);
    const uniRouter = new ethers.Contract(UNIV3_ROUTER, UNIV3_ROUTER_ABI, wallet);
    const slipMin = univ3WethOut.mul(99).div(100);
    const tx1 = await uniRouter.exactInputSingle(
      { tokenIn: USDC, tokenOut: WETH, fee: POOL_FEE, recipient: wallet.address, deadline, amountIn: amountInRaw, amountOutMinimum: slipMin, sqrtPriceLimitX96: 0 },
      { gasLimit: 400000, ...overrides, nonce }
    );
    console.log('  Leg 1 tx:', tx1.hash);
    receipt = await tx1.wait();
    const wethBal = await new ethers.Contract(WETH, ERC20_ABI, provider).balanceOf(wallet.address);

    // Leg 2: Sushi WETH→USDC
    const wethC = new ethers.Contract(WETH, ERC20_ABI, wallet);
    await ensureApproved(wethC, SUSHI, wethBal, wallet);
    const slipMin2 = (await sushi.getAmountsOut(wethBal, [WETH, USDC]))[1].mul(99).div(100);
    const nonce2 = await provider.getTransactionCount(wallet.address, 'pending');
    const overrides2 = await getGasOverrides(provider);
    const tx2 = await sushi.swapExactTokensForTokens(wethBal, slipMin2, [WETH, USDC], wallet.address, deadline,
      { gasLimit: 400000, ...overrides2, nonce: nonce2 });
    console.log('  Leg 2 tx:', tx2.hash);
    const receipt2 = await tx2.wait();
    finalBal = await usdcC.balanceOf(wallet.address);
    console.log('  Arbiscan leg 1:', `https://arbiscan.io/tx/${receipt.transactionHash}`);
    console.log('  Arbiscan leg 2:', `https://arbiscan.io/tx/${receipt2.transactionHash}`);
  }

  // ── Step 6: Realized PnL ─────────────────────────────────────────────────
  const realizedGross = parseFloat(ethers.utils.formatUnits(finalBal.sub(startBal), 6));
  const realizedNet   = realizedGross - gasCostUsd;

  console.log('\n── Realized PnL ──');
  console.log(`  Gross PnL:  $${realizedGross.toFixed(6)} USDC`);
  console.log(`  Gas cost:  ~$${gasCostUsd.toFixed(4)}`);
  console.log(`  Net PnL:    $${realizedNet.toFixed(6)}`);
  console.log(realizedNet >= 0 ? '  ✅ PROFITABLE' : '  ⚠️  NET LOSS (slippage or price drift)');
}

main().catch(err => {
  console.error('\n[cross-dex-arb] Fatal:', err.message?.slice(0, 300));
  process.exit(1);
});
