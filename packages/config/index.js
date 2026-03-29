require("dotenv").config();

function required(name, fallback = "") {
  return process.env[name] || fallback;
}

const SAFE_MODE = String(process.env.SAFE_MODE || "true").toLowerCase() === "true";

module.exports = {
  SAFE_MODE,
  PRIVATE_KEY: required("PRIVATE_KEY", ""),
  MIN_PROFIT_USD: Number(process.env.MIN_PROFIT_USD || 40),
  ARB_CONTRACT_ADDRESS: process.env.ARB_CONTRACT_ADDRESS || "",
  CHAINS: {
    ARBITRUM: {
      name: "arbitrum",
      chainId: 42161,
      rpcs: [
        process.env.ARB_RPC_EXEC,
        process.env.ARB_RPC_SCAN,
        process.env.ARB_RPC_CONF
      ].filter(Boolean),
      mevRelay: process.env.ARB_MEV_RELAY || "",
      contractAddress: process.env.ARB_CONTRACT_ADDRESS || "",
      pollingInterval: 1000
    },
    BASE: {
      name: "base",
      chainId: 8453,
      rpcs: [
        process.env.BASE_RPC_EXEC,
        process.env.BASE_RPC_SCAN,
        process.env.BASE_RPC_CONF
      ].filter(Boolean),
      mevRelay: process.env.BASE_MEV_RELAY || "",
      contractAddress: process.env.BASE_CONTRACT_ADDRESS || "",
      pollingInterval: 1000
    }
  }
};
