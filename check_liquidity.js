require('dotenv').config({ path: require('path').resolve(__dirname, './.env') });
const { ethers } = require('ethers');

async function check() {
    console.log("=== 🔍 ENTERPRISE ARBITRAGE FLASH LOAN DIAGNOSTIC ===\n");
    
    if (!process.env.PRIVATE_KEY) {
        console.log("❌ CRITICAL: No PRIVATE_KEY found in .env\n");
        return;
    }
    
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY);
    console.log(`🏦 EXECUTOR WALLET ADDRESS: ${wallet.address}`);
    
    const chains = [
        { name: "Arbitrum", url: process.env.ARB_RPC_SCAN, currency: "ETH" },
        { name: "Base", url: process.env.BASE_RPC_SCAN, currency: "ETH" },
        { name: "BSC", url: process.env.BSC_RPC_SCAN, currency: "BNB" }
    ];

    console.log("\n⛽ NATIVE WALLET GAS BALANCES:");
    for (const c of chains) {
        if (!c.url) continue;
        try {
            const provider = new ethers.providers.JsonRpcProvider(c.url);
            const bal = await provider.getBalance(wallet.address);
            console.log(` - ${c.name}: ${ethers.utils.formatEther(bal)} ${c.currency}`);
        } catch (e) {
            console.log(` - ${c.name}: ERROR (${e.message.substring(0,40)})`);
        }
    }
    
    // Aave V3 Pool addresses
    const AAVE_POOLS = {
        Arbitrum: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
        Base: "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5",
        BSC: "0x6807dc923806fE8Fd134338EABCA509979a7e0cB"
    };
    
    const STABLECOIN = {
        Arbitrum: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", // USDC
        Base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // USDC
        BSC: "0x55d398326f99059fF775485246999027B3197955" // USDT
    };
    
    const WRAPPED_NATIVE = {
        Arbitrum: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", // WETH
        Base: "0x4200000000000000000000000000000000000006", // WETH
        BSC: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c" // WBNB
    };

    console.log("\n⚡ AAVE V3 FLASH LOAN BORROW POWER (Available Live Liquidity):");
    
    const erc20Abi = ["function balanceOf(address) view returns (uint256)", "function decimals() view returns (uint8)", "function symbol() view returns (string)"];
    
    for (const c of chains) {
        if (!AAVE_POOLS[c.name]) continue;
        try {
            const provider = new ethers.providers.JsonRpcProvider(c.url);
            const stableContract = new ethers.Contract(STABLECOIN[c.name], erc20Abi, provider);
            const wrapContract = new ethers.Contract(WRAPPED_NATIVE[c.name], erc20Abi, provider);
            
            const stableBal = await stableContract.balanceOf(AAVE_POOLS[c.name]);
            const wrapBal = await wrapContract.balanceOf(AAVE_POOLS[c.name]);
            
            const stableDecimals = await stableContract.decimals();
            const stableSym = await stableContract.symbol();
            const wrapSym = await wrapContract.symbol();
            const wrapDecimals = await wrapContract.decimals();
            
            console.log(` - ${c.name} Aave Pool Capacity:`);
            console.log(`     -> ${ethers.utils.formatUnits(stableBal, stableDecimals)} ${stableSym}`);
            console.log(`     -> ${ethers.utils.formatUnits(wrapBal, wrapDecimals)} ${wrapSym}`);
        } catch (e) {
            console.log(` - ${c.name} Aave Pool: LOGIC ERROR (${e.message.substring(0,40)})`);
        }
    }
    console.log("\n=======================================================");
}
check();
