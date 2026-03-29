const { ethers } = require("ethers");

class TxRouter {
  constructor(arbContractAddress, provider, wallet) {
    this.arbContractAddress = arbContractAddress;
    this.provider = provider;
    this.wallet = wallet;
  }

  async buildPayload(tokenIn, amountInRaw, targets, payloads, opts = {}) {
    if (!targets?.length || !payloads?.length) {
      throw new Error("TxRouter.buildPayload called without route targets/payloads");
    }

    const tx = {
      to: this.arbContractAddress,
      data: opts.calldata,
      value: opts.value || 0,
      gasLimit: opts.gasLimit || 700000,
      ...(opts.targetGasPrice ? { gasPrice: opts.targetGasPrice } : {})
    };

    if (!tx.data) {
      throw new Error("TxRouter.buildPayload requires canonical calldata");
    }

    return await this.wallet.signTransaction(tx);
  }

  async estimateGas(calldata, value = 0) {
    return await this.provider.estimateGas({
      from: this.wallet.address,
      to: this.arbContractAddress,
      data: calldata,
      value
    });
  }
}

module.exports = TxRouter;
