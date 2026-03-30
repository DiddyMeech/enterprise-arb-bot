'use strict';
const { ethers } = require('ethers');
const { getDex } = require('../../config/chains');

// QuickSwap V2 uses the same interface as Uniswap V2 / SushiSwap
const QUICKSWAP_ROUTER_IFACE = new ethers.utils.Interface([
  'function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts)'
]);

class QuickSwapAdapter {
  constructor({ chainKey, provider }) {
    this.chainKey = chainKey;
    this.provider = provider;
    this.dex = getDex(chainKey, 'quickswap');

    this.contract = new ethers.Contract(
      this.dex.router,
      QUICKSWAP_ROUTER_IFACE,
      provider
    );
  }

  get name() { return 'quickswap'; }
  get feeBps() { return this.dex.feeBps; }
  get router() { return this.dex.router; }
  get kind() { return this.dex.kind; }

  async quoteExactIn({ tokenIn, tokenOut, amountInRaw }) {
    const amounts = await this.contract.getAmountsOut(amountInRaw, [tokenIn, tokenOut]);

    if (!amounts || amounts.length < 2) {
      throw new Error('QUICKSWAP_BAD_QUOTE');
    }

    return {
      dex: this.name,
      kind: this.kind,
      router: this.router,
      tokenIn,
      tokenOut,
      amountInRaw: ethers.BigNumber.from(amountInRaw).toString(),
      amountOutRaw: ethers.BigNumber.from(amounts[1]).toString(),
      feeBps: this.feeBps
    };
  }
}

module.exports = { QuickSwapAdapter };
