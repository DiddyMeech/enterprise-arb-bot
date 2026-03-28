const { ethers } = require('ethers');

class BaseDexAdapter {
    constructor(name, routerAddress, provider) {
        this.name = name;
        this.routerAddress = routerAddress;
        this.provider = provider;
        
        // Standard V2 Router ABI supporting PancakeSwap and SushiSwap
        this.abi = [
            "function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)"
        ];
        this.contract = new ethers.Contract(this.routerAddress, this.abi, this.provider);
    }

    async getAmountOut(amountIn, path) {
        const amounts = await this.contract.getAmountsOut(amountIn, path);
        return amounts[amounts.length - 1]; // Return final estimated hop output
    }
}

class UniswapV3Adapter extends BaseDexAdapter {
    constructor(routerAddress, quoterAddress, provider) {
        super("UniswapV3", routerAddress, provider);
        this.quoterAddress = quoterAddress;
        
        // QuoterV2 ABI mapping typical for Arbitrum/Base native Univ3 forks
        this.quoterAbi = [
            "function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external returns (uint256 amountOut)"
        ];
        this.quoter = new ethers.Contract(this.quoterAddress, this.quoterAbi, this.provider);
    }

    async getAmountOut(amountIn, path) {
        // Defaults to the baseline 0.3% fee tier (3000) for internal standard routing tests
        return await this.quoter.callStatic.quoteExactInputSingle(path[0], path[1], 3000, amountIn, 0);
    }
}

module.exports = { BaseDexAdapter, UniswapV3Adapter };
