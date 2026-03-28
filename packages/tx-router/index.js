const { ethers } = require('ethers');

class TxRouter {
    constructor(arbContractAddress, provider, wallet) {
        this.arbContractAddress = arbContractAddress;
        this.provider = provider;
        this.wallet = wallet;
        
        // Native Aave V3 MevRouter Interface map
        const abi = [
            "function requestFlashLoan(address asset, uint256 amount, bytes calldata params) external"
        ];
        this.contract = new ethers.Contract(this.arbContractAddress, abi, this.wallet);
    }

    async buildPayload(asset, amount, targets, payloads, gasParams) {
        // Strict transaction generation handling internal nonces
        const nonce = await this.provider.getTransactionCount(this.wallet.address);
        
        // Dynamically encode the DEX array instructions into raw bytes for Aave executeOperation extraction
        const innerParams = ethers.utils.defaultAbiCoder.encode(
            ['address[]', 'bytes[]'], 
            [targets || [], payloads || []]
        );

        const tx = await this.contract.populateTransaction.requestFlashLoan(
            asset,
            amount,
            innerParams,
            {
                gasLimit: gasParams.gasLimit || 500000, // Flashloans execute multi-hop logic requiring higher gas ceiling
                maxFeePerGas: gasParams.targetGasPrice, // EIP-1559 standard execution
                maxPriorityFeePerGas: gasParams.targetGasPrice, 
                nonce
            }
        );
        
        return await this.wallet.signTransaction(tx);
    }
}

module.exports = TxRouter;
