const { ethers } = require('ethers');
require('dotenv').config();
async function main() {
    const rpc = "https://base-mainnet.g.alchemy.com/v2/pSLmhjyc-4LdT-bUrSr3m0Ks5lBCF_sr";
    const provider = new ethers.providers.JsonRpcProvider(rpc);
    const abi = ["function getPool() external view returns (address)"];
    
    const candidates = [
        "0xe20fCBdBfFC4Dd138cE8b2E6FBb6CB49723bd8CB",
        "0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb" // Arbitrum one
    ];
    for (let c of candidates) {
        try {
            const contract = new ethers.Contract(c, abi, provider);
            const pool = await contract.getPool();
            console.log(`[SUCCESS] ${c} -> getPool() = ${pool}`);
        } catch (err) {
            console.log(`[FAILED] ${c} -> ${err.message.substring(0, 50)}`);
        }
    }
}
main();
