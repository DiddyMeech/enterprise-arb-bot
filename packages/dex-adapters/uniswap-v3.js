const { ethers } = require('ethers');
const { logger } = require('@arb/telemetry');

// Advanced Uniswap V3 Smart Router Interface
// Capable of stripping V2/V3 multicall and exactInput payloads physically intercepting MEMPOOL memsets
const UNISWAP_V3_ROUTER_ABI = [
    "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountOut)",
    "function exactInput((bytes path, address recipient, uint256 amountIn, uint256 amountOutMinimum)) external payable returns (uint256 amountOut)",
    "function multicall(bytes[] calldata data) external payable returns (bytes[] memory results)",
    "function multicall(uint256 deadline, bytes[] calldata data) external payable returns (bytes[] memory results)"
];

class UniswapV3Decoder {
    constructor() {
        this.interface = new ethers.utils.Interface(UNISWAP_V3_ROUTER_ABI);
    }

    /**
     * Reconstructs the raw cryptographic payload of an unconfirmed mempool transaction.
     * @param {Object} tx The raw transaction object from provider.getTransaction()
     * @returns {Object|null} The decoded token routing mapping or null if unrecognized
     */
    decodeSwap(tx) {
        if (!tx || !tx.data || tx.data === "0x") return null;

        try {
            // Physically match the function signature to our ABI matrix
            const parsed = this.interface.parseTransaction({ data: tx.data });

            // Evaluate standard single-pool traversal routing
            if (parsed.name === "exactInputSingle") {
                const params = parsed.args[0];
                return {
                    dex: "UniswapV3",
                    type: "exactInputSingle",
                    tokenIn: params.tokenIn,
                    tokenOut: params.tokenOut,
                    amountIn: params.amountIn,
                    feeTier: params.fee
                };
            }

            // Evaluate multi-hop path traversal routing (requires bytes unrolling)
            if (parsed.name === "exactInput") {
                const params = parsed.args[0];
                const pathBytes = params.path;
                
                // Natively unwrap the packed cryptographic byte-string (Address + uint24 + Address)
                // path encoding: tokenIn (20) + fee (3) + tokenOut (20)...
                const extractedTokenIn = "0x" + pathBytes.substring(2, 42); // First 20 bytes (Hex is 40 chars)
                const extractedTokenOutSubstringStart = pathBytes.length - 40;
                const extractedTokenOut = "0x" + pathBytes.substring(extractedTokenOutSubstringStart); // Last 20 bytes

                return {
                    dex: "UniswapV3",
                    type: "exactInput",
                    tokenIn: extractedTokenIn,
                    tokenOut: extractedTokenOut,
                    amountIn: params.amountIn,
                    rawPath: pathBytes
                };
            }

            // Unpack nested multicall execution arrays used universally by modern V3 front-ends
            if (parsed.name === "multicall") {
                const dataArray = parsed.args.data || parsed.args[1]; // Handle both multicall variations
                if (dataArray) {
                    for (const innerData of dataArray) {
                        try {
                            const innerParsed = this.interface.parseTransaction({ data: innerData });
                            
                            if (innerParsed.name === "exactInputSingle") {
                                const params = innerParsed.args[0];
                                return {
                                    dex: "UniswapV3",
                                    type: "exactInputSingle_Multicall",
                                    tokenIn: params.tokenIn,
                                    tokenOut: params.tokenOut,
                                    amountIn: params.amountIn,
                                    feeTier: params.fee
                                };
                            }
                        } catch(e) {}
                    }
                }
            }
            return null;
        } catch (error) {
            // Function signature is not a mapped Uniswap structure
            return null;
        }
    }
}

module.exports = new UniswapV3Decoder();
