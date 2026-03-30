const { ethers } = require('ethers');
const { getDex } = require('../../config/chains');

const SUSHI_ROUTER_IFACE = new ethers.utils.Interface([
  'function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts)'
]);

class SushiAdapter {
  constructor({ chainKey, provider }) {
    this.chainKey = chainKey;
    this.provider = provider;
    this.dex = getDex(chainKey, 'sushi');

    this.contract = new ethers.Contract(
      this.dex.router,
      SUSHI_ROUTER_IFACE,
      provider
    );
  }

  get name() {
    return 'sushi';
  }

  get feeBps() {
    return this.dex.feeBps;
  }

  get router() {
    return this.dex.router;
  }

  get kind() {
    return this.dex.kind;
  }

  async quoteExactIn({ tokenIn, tokenOut, amountInRaw }) {
    const amounts = await this.contract.getAmountsOut(amountInRaw, [
      tokenIn,
      tokenOut
    ]);

    if (!amounts || amounts.length < 2) {
      throw new Error('SUSHI_BAD_QUOTE');
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

module.exports = {
  SushiAdapter
};
