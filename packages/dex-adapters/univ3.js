'use strict';
const { ethers } = require('ethers');
const { getDex } = require('../../config/chains');

const UNIV3_QUOTER_IFACE = new ethers.utils.Interface([
  // QuoterV2 ABI — used on Polygon (0x61fFE014bA17989E743c5F6cB21bF9697530B21e)
  'function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)'
]);

class UniV3Adapter {
  // feeTier can be passed to override the default (500) so you can probe 3000 separately
  constructor({ chainKey, provider, feeTier }) {
    this.chainKey = chainKey;
    this.provider = provider;
    this.dex = getDex(chainKey, 'univ3');
    this._feeTier = feeTier || this.dex.fee;

    this.contract = new ethers.Contract(
      this.dex.quoter,
      UNIV3_QUOTER_IFACE,
      provider
    );
  }

  get name() { return `univ3_${this._feeTier}`; }
  get feeBps() { return Math.round(this._feeTier / 100); }
  get router() { return this.dex.router; }
  get kind() { return this.dex.kind; }
  get fee() { return this._feeTier; }

  async quoteExactIn({ tokenIn, tokenOut, amountInRaw }) {
    const [amountOut] = await this.contract.callStatic.quoteExactInputSingle({
      tokenIn,
      tokenOut,
      amountIn: amountInRaw,
      fee: this._feeTier,
      sqrtPriceLimitX96: 0
    });

    return {
      dex: this.name,
      kind: this.kind,
      router: this.router,
      fee: this._feeTier,
      tokenIn,
      tokenOut,
      amountInRaw: ethers.BigNumber.from(amountInRaw).toString(),
      amountOutRaw: ethers.BigNumber.from(amountOut).toString(),
      feeBps: this.feeBps
    };
  }
}

module.exports = { UniV3Adapter };
