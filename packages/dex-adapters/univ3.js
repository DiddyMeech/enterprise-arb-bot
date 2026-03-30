const { ethers } = require('ethers');
const { getDex } = require('../../config/chains');

const UNIV3_QUOTER_IFACE = new ethers.utils.Interface([
  'function quoteExactInputSingle(address tokenIn,address tokenOut,uint24 fee,uint256 amountIn,uint160 sqrtPriceLimitX96) external returns (uint256 amountOut)'
]);

class UniV3Adapter {
  constructor({ chainKey, provider }) {
    this.chainKey = chainKey;
    this.provider = provider;
    this.dex = getDex(chainKey, 'univ3');

    this.contract = new ethers.Contract(
      this.dex.quoter,
      UNIV3_QUOTER_IFACE,
      provider
    );
  }

  get name() {
    return 'univ3';
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

  get fee() {
    return this.dex.fee;
  }

  async quoteExactIn({ tokenIn, tokenOut, amountInRaw }) {
    const amountOut = await this.contract.callStatic.quoteExactInputSingle(
      tokenIn,
      tokenOut,
      this.fee,
      amountInRaw,
      0
    );

    return {
      dex: this.name,
      kind: this.kind,
      router: this.router,
      fee: this.fee,
      tokenIn,
      tokenOut,
      amountInRaw: ethers.BigNumber.from(amountInRaw).toString(),
      amountOutRaw: ethers.BigNumber.from(amountOut).toString(),
      feeBps: this.feeBps
    };
  }
}

module.exports = {
  UniV3Adapter
};
