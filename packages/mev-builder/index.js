const { ethers } = require('ethers');
const config = require('@arb/config');
const TxRouter = require('@arb/tx-router');

class MevBuilder {
    constructor(provider, wallet) {
        this.provider = provider;
        this.wallet = wallet;
        this.txRouter = new TxRouter(config.ARB_CONTRACT_ADDRESS, this.provider, this.wallet);
    }

    async buildAndBroadcastBundle(payload, targets, executePayloads) {
        try {
            // Use the exact amount determined by the quote engine or scanner payload
            let flashloanAmount = payload.amountIn;

            // Build standard Aave V3 Flashloan Transaction
            const gasParams = {
                gasLimit: 800000, 
                targetGasPrice: await this.provider.getGasPrice()
            };

            const signedTx = await this.txRouter.buildPayload(
                payload.tokenIn,
                flashloanAmount,
                targets,
                executePayloads,
                gasParams
            ); // This returns a raw signed transaction from the operator's wallet

            // In an actual Flashbots/Relayer scenario we wrap this in a bundle
            const bundle = [
                { signedTransaction: signedTx }
            ];

            console.log(`[MEV-BUILDER] Bundle constructed. Broadcasting to private relayers...`);
            
            // Basic JSON-RPC payload for standard Flashbots eth_sendBundle
            const body = JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'eth_sendBundle',
                params: [
                    {
                        txs: bundle.map(b => b.signedTransaction),
                        blockNumber: `0x${((await this.provider.getBlockNumber()) + 1).toString(16)}`,
                    }
                ]
            });

            // Using standard fetch since cross-chain relayers might vary
            const response = await fetch(config.MEV_RELAYS.FLASHBOTS, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Flashbots-Signature': `${this.wallet.address}:${await this.wallet.signMessage(ethers.utils.id(body))}`
                },
                body
            });

            const result = await response.json();
            if (result.error) {
                throw new Error(`Bundle Rejection: ${result.error.message}`);
            }

            return {
                execId: payload.id,
                status: 'BROADCAST_SUCCESS',
                netProfitUsd: 0, 
                gasPaidUsd: 0,
                bundleHash: result.result?.bundleHash || null,
            };
        } catch (error) {
            console.error(`[MEV-BUILDER] Error broadcasting bundle:`, error.message);
            return {
                execId: payload.id,
                status: 'REVERTED',
                revertReason: error.message
            };
        }
    }
}

module.exports = MevBuilder;
