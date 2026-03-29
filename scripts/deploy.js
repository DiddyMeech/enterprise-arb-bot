require('dotenv').config();
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

async function main() {
    const network = process.argv[2] || 'base';
    
    let rpcUrl, poolAddress;
    if (network === 'arbitrum') {
        rpcUrl = process.env.ARB_RPC_SCAN || process.env.ARB_RPC_EXEC || "https://arb1.arbitrum.io/rpc";
        poolAddress = '0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb'; // Aave V3 Arbi
    } else {
        // Fallback explicitly to the User's Premium Alchemy Base endpoint to bypass QuickNode gas/nonce stalls
        rpcUrl = "https://base-mainnet.g.alchemy.com/v2/pSLmhjyc-4LdT-bUrSr3m0Ks5lBCF_sr"; 
        poolAddress = '0xe20fCBdBfFC4Dd138cE8b2E6FBb6CB49777ad64D'; // Official BGD-Labs Source Aave V3 Base Registry
    }

    if (!process.env.PRIVATE_KEY) {
        console.error("[FATAL] PRIVATE_KEY not found in .env. Deployment aborted.");
        process.exit(1);
    }

    console.log(`\n[DEPLOYMENT] Initializing Ethers Node Connection to ${network.toUpperCase()}...`);
    const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
    
    console.log(`[DEPLOYMENT] Authorized Executor Wallet: ${wallet.address}`);
    
    try {
        const balance = await provider.getBalance(wallet.address);
        console.log(`[DEPLOYMENT] Current ETH Balance: ${ethers.utils.formatEther(balance)} ETH`);
        if (balance.eq(0)) {
            console.error("[FATAL] Insufficient ETH for gas execution. Wallet is completely empty! Please fund the wallet and retry.");
            process.exit(1);
        }
    } catch (e) {
        console.error("[FATAL] RPC Connection Fault:", e.message);
        process.exit(1);
    }
    
    console.log(`[DEPLOYMENT] Target AAVE V3 Pool Provider: ${poolAddress}`);

    const artifactPath = path.resolve(__dirname, '../artifacts/contracts/TitanArbitrageExecutor.sol/TitanArbitrageExecutor.json');
    if (!fs.existsSync(artifactPath)) {
        console.error("[FATAL] Contract artifact missing. Run 'npx hardhat compile' first to generate ABI.");
        process.exit(1);
    }

    const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
    const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
    
    console.log("[DEPLOYMENT] Broadcasting Titan Smart Contract binary sequence to EVM...");
    try {
        let overrides = {};
        if (network !== 'arbitrum') {
            // Enforcing Legacy Type-0 Gas Override to shatter the EIP-1559 0.6 ETH bug Native Ethers encounters on Layer-2s
            overrides = {
                gasLimit: 8000000,
                gasPrice: await provider.getGasPrice()
            };
        }
        const contract = await factory.deploy(poolAddress, wallet.address, overrides);
        console.log(`[DEPLOYMENT] Transaction Broadcasted! Hash: ${contract.deployTransaction.hash}`);
        console.log("[DEPLOYMENT] Waiting for 1 block confirmation...");
        
        await contract.deployTransaction.wait(1); // Wait explicitly for 1 block
        
        console.log(`\n✅ [SUCCESS] TitanExecutor securely deployed to: ${contract.address}\n`);

        // Dynamically write to .env to complete Phase 7 binding natively
        const envPath = path.resolve(__dirname, '../.env');
        let envData = fs.readFileSync(envPath, 'utf8');
        
        if (envData.includes('ARB_CONTRACT_ADDRESS=')) {
            envData = envData.replace(/ARB_CONTRACT_ADDRESS=.*/g, `ARB_CONTRACT_ADDRESS=${contract.address}`);
        } else {
            envData += `\n# ⛓️ PHYSICAL AAVE ROUTER\nARB_CONTRACT_ADDRESS=${contract.address}\n`;
        }
        fs.writeFileSync(envPath, envData, 'utf8');
        
        console.log("[DEPLOYMENT] Master routing parameter written to .env perfectly. Ready for PM2 injection.");
    } catch (e) {
        console.error("[FATAL] Contract deployment failed. Error trace:", e.message);
        process.exit(1);
    }
}

main();
