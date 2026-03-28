const { ethers } = require('ethers');

class MathUtil {
    // Calculates strict minimum output bounds locally before verifying on-chain constraints
    static calculateSlippage(amount, slippageBps) {
        // slippageBps: 100 = 1%
        const slippageMultiplier = ethers.BigNumber.from(10000 - slippageBps);
        return amount.mul(slippageMultiplier).div(10000);
    }
    
    // Core logic matching evaluation constraints directly mirroring the spec:
    // netProfit = output - input - gas - fees - safetyBuffer 
    static estimateNetProfit(revenueNative, inputNative, gasLimit, gasPrice, tokenUsdPrice, safetyBufferUsd = 0) {
        const gasCostNative = gasLimit.mul(gasPrice);
        const grossProfitNative = revenueNative.sub(inputNative);
        
        const netProfitNative = grossProfitNative.sub(gasCostNative);
        const netProfitUsd = parseFloat(ethers.utils.formatEther(netProfitNative)) * tokenUsdPrice;
        
        const strictNetUsd = netProfitUsd - safetyBufferUsd;
        
        return {
            netProfitNative,
            netProfitUsd: strictNetUsd,
            gasCostNative,
            gasCostUsd: parseFloat(ethers.utils.formatEther(gasCostNative)) * tokenUsdPrice,
            grossProfitNative
        };
    }
    
    static calculateGasToProfitRatio(gasCostUsd, profitUsd) {
        if (profitUsd <= 0) return Infinity;
        return gasCostUsd / profitUsd;
    }
}

module.exports = { MathUtil };
