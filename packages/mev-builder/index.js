const { ethers } = require('ethers');
const config = require('@arb/config');
const TxRouter = require('@arb/tx-router');

class MevBuilder {
    constructor(provider, wallet, contractAddress) {
        this.provider = provider;
        this.wallet = wallet;
        this.txRouter = new TxRouter(contractAddress || config.ARB_CONTRACT_ADDRESS, this.provider, this.wallet);
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

            // Dynamically evaluate chain target to prevent broadcasting L2 payloads to L1 Flashbots
            const chainId = (await this.provider.getNetwork()).chainId;
            let relayEndpoint = config.MEV_RELAYS.FLASHBOTS; // Fallback Mainnet
            
            if (chainId === 42161) {
                relayEndpoint = "https://arbitrum.mempool.bloxroute.cloud";
            } else if (chainId === 8453) {
                relayEndpoint = "https://base.mempool.bloxroute.cloud";
            } else if (chainId === 10) {
                relayEndpoint = "https://api.optimism.mempool.bloxroute.cloud";
            }

            // Using standard fetch since cross-chain relayers might vary
            const headers = {
                'Content-Type': 'application/json'
            };
            
            if (relayEndpoint === config.MEV_RELAYS.FLASHBOTS) {
                headers['X-Flashbots-Signature'] = `${this.wallet.address}:${await this.wallet.signMessage(ethers.utils.id(body))}`;
            } else if (config.MEV_RELAYS.BLOXROUTE_AUTH) {
                headers['Authorization'] = config.MEV_RELAYS.BLOXROUTE_AUTH;
            }

            const response = await fetch(relayEndpoint, {
                method: 'POST',
                headers,
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
