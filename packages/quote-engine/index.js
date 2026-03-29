const { ethers } = require('ethers');
const { logger } = require('@arb/telemetry');

class QuoteEngine {
    constructor(providers) {
        this.providers = providers; // Map of chainId -> optimal provider
    }

    async getOptimalQuote(tokenIn, tokenOut, amountIn, dexAdapters) {
        // Build hardcoded router mapping for payloads
        const DEX_ROUTERS = {
            UniswapV3: {
                Arb: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45",
                Base: "0x2626664c2603336E57B271c5C0b26F421741e481",
                OP: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45"
            },
            SushiSwap: { // Generic V2 clones
                Arb: "0x1b02da8cb0d097eb8d57a175b88c7d8b47997506",
                Base: "0x327Df1E6de05B9A098E56B0868f7b52044458dE7",
                OP: "0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506"
            }
        };

        const executePayloads = [];
        const targets = [];
        
        let bestQuote = null;
        let bestDex = null;

        // Concurrently fetch pricing quotes across all locally mapped DEX adapters for speed
        const quotePromises = dexAdapters.map(async (adapter) => {
            try {
                const quote = await adapter.getAmountOut(amountIn, [tokenIn, tokenOut]);
                return { adapter: adapter.name, quote };
            } catch (err) {
                logger.debug(`[QUOTE ENGINE] Adapter ${adapter.name} failed quote projection: ${err.message}`);
                return null;
            }
        });

        const results = await Promise.all(quotePromises);

        for (const res of results) {
            if (res && res.quote) {
                if (!bestQuote || res.quote.gt(bestQuote)) {
                    bestQuote = res.quote;
                    bestDex = res.adapter;
                }
            }
        }

        // Determine chain context (fallback to OP if not explicitly bound)
        const network = await this.providers.getNetwork();
        let chainName = "OP";
        if (network.chainId === 42161) chainName = "Arb";
        else if (network.chainId === 8453) chainName = "Base";

        const config = require('@arb/config');
        const chainConfig = Object.values(config.CHAINS).find(c => c.id === network.chainId) || {};
        const executorAddress = chainConfig.contractAddress || config.ARB_CONTRACT_ADDRESS || "0x0000000000000000000000000000000000000000";

        const uniRouter = DEX_ROUTERS.UniswapV3[chainName];
        const sushiRouter = DEX_ROUTERS.SushiSwap[chainName];
        
        const erc20Iface = new ethers.utils.Interface([
            "function approve(address spender, uint256 amount) external returns (bool)"
        ]);
        const uniIface = new ethers.utils.Interface([
            "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountOut)"
        ]);
        const sushiIface = new ethers.utils.Interface([
            "function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) external returns (uint[] memory amounts)"
        ]);

        const MAX_UINT256 = ethers.constants.MaxUint256;

        // Construct 4-Stage Multi-Hop Loop (TokenIn -> TokenOut -> TokenIn)
        if (bestQuote) {
            // Implement local allowance cache pattern to eliminate redundant approve() gas costs
            if (!QuoteEngine.allowanceCache) QuoteEngine.allowanceCache = new Set();
            
            const cacheKeyUni = `${executorAddress}-${tokenIn}-${uniRouter}`;
            if (!QuoteEngine.allowanceCache.has(cacheKeyUni)) {
                targets.push(tokenIn);
                executePayloads.push(erc20Iface.encodeFunctionData("approve", [uniRouter, MAX_UINT256]));
                QuoteEngine.allowanceCache.add(cacheKeyUni);
            }

            // Leg 1: Execution Phase (UniswapV3)
            targets.push(uniRouter);
            executePayloads.push(uniIface.encodeFunctionData("exactInputSingle", [{
                tokenIn,
                tokenOut,
                fee: 3000,
                recipient: executorAddress,
                amountIn,
                amountOutMinimum: 0,
                sqrtPriceLimitX96: 0
            }]));

            const cacheKeySushi = `${executorAddress}-${tokenOut}-${sushiRouter}`;
            if (!QuoteEngine.allowanceCache.has(cacheKeySushi)) {
                targets.push(tokenOut);
                executePayloads.push(erc20Iface.encodeFunctionData("approve", [sushiRouter, MAX_UINT256]));
                QuoteEngine.allowanceCache.add(cacheKeySushi);
            }

            // Leg 2: Execution Phase (SushiSwap) - Sweeps quote dynamically back to origin asset
            targets.push(sushiRouter);
            executePayloads.push(sushiIface.encodeFunctionData("swapExactTokensForTokens", [
                bestQuote, 
                0, 
                [tokenOut, tokenIn],
                executorAddress,
                Math.floor(Date.now() / 1000) + 60 * 20
            ]));
        }

        return { bestQuote, bestDex, targets, executePayloads };
    }
}

module.exports = QuoteEngine;
