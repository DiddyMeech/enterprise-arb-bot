const { ethers } = require("ethers");

const MULTICALL3_ABI = [
  "function aggregate3(tuple(address target,bool allowFailure,bytes callData)[] calls) payable returns (tuple(bool success,bytes returnData)[] returnData)"
];

const multicallIface = new ethers.utils.Interface(MULTICALL3_ABI);

function getMulticallAddress() {
  return (
    process.env.MULTICALL3_ADDRESS ||
    process.env.POLYGON_MULTICALL3_ADDRESS ||
    // common Multicall3 deployment; set explicitly in .env if you prefer
    "0xcA11bde05977b3631167028862bE2a173976CA11"
  );
}

function encodeCall(abi, fn, args = []) {
  const iface = new ethers.utils.Interface(abi);
  return {
    iface,
    callData: iface.encodeFunctionData(fn, args),
  };
}

function decodeCallResult(iface, fn, returnData) {
  return iface.decodeFunctionResult(fn, returnData);
}

async function providerCallWithTimeout(provider, tx, timeoutMs) {
  return Promise.race([
    provider.call(tx),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`RPC_CALL_TIMEOUT:${timeoutMs}`)), timeoutMs)
    ),
  ]);
}

async function aggregate3(provider, calls, timeoutMs = 2500) {
  const target = getMulticallAddress();
  const data = multicallIface.encodeFunctionData("aggregate3", [calls]);
  const raw = await providerCallWithTimeout(provider, { to: target, data }, timeoutMs);
  const [results] = multicallIface.decodeFunctionResult("aggregate3", raw);
  return results.map((r) => ({
    success: r.success,
    returnData: r.returnData,
  }));
}

async function promiseWithTimeout(promise, timeoutMs, label = "TIMEOUT") {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label}:${timeoutMs}`)), timeoutMs)
    ),
  ]);
}

module.exports = {
  aggregate3,
  encodeCall,
  decodeCallResult,
  getMulticallAddress,
  providerCallWithTimeout,
  promiseWithTimeout,
};
