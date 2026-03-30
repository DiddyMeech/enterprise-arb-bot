const { ethers } = require('ethers');

const STANDARD_EXECUTOR_IFACE = new ethers.utils.Interface([
  'function executeArbitrage(address tokenA,address tokenB,uint256 amountIn,address[] calldata routers,uint256[] calldata legMinOuts,uint256 minProfit,uint256 deadline) external returns (uint256)'
]);

const FLASH_EXECUTOR_IFACE = new ethers.utils.Interface([
  'function requestFlashLoan(address _token,uint256 _amount,bytes calldata _params) external'
]);

function buildExecutionPlan({ executorAddress, route, gasLimit = 900000 }) {
  if (!executorAddress) {
    throw new Error('MISSING_EXECUTOR_ADDRESS');
  }

  if (!route || !Array.isArray(route.legs) || route.legs.length < 2) {
    throw new Error('INVALID_ROUTE');
  }

  const routers = route.legs.map((leg) => leg.router);
  const legMinOuts = route.legs.map((leg) => leg.minOutRaw);

  const calldata = STANDARD_EXECUTOR_IFACE.encodeFunctionData('executeArbitrage', [
    route.tokenIn,
    route.tokenOut,
    route.amountInRaw,
    routers,
    legMinOuts,
    route.minProfitTokenRaw || '1',
    route.deadline
  ]);

  return {
    type: 'standard',
    target: executorAddress,
    calldata,
    gasLimit
  };
}

function buildFlashExecutionPlan({ flashExecutorAddress, route, gasLimit = 1200000 }) {
  if (!flashExecutorAddress) {
    throw new Error('MISSING_FLASH_EXECUTOR_ADDRESS');
  }

  if (!route || !Array.isArray(route.legs) || route.legs.length < 2) {
    throw new Error('INVALID_ROUTE');
  }

  const targets = route.legs.map((leg) => leg.router);
  const payloads = route.legs.map((leg) =>
    ethers.utils.defaultAbiCoder.encode(
      ['address', 'address', 'uint256', 'uint256', 'uint256'],
      [leg.tokenIn, leg.tokenOut, leg.amountInRaw, leg.minOutRaw, route.deadline]
    )
  );

  const params = ethers.utils.defaultAbiCoder.encode(
    ['address[]', 'bytes[]'],
    [targets, payloads]
  );

  const calldata = FLASH_EXECUTOR_IFACE.encodeFunctionData('requestFlashLoan', [
    route.tokenIn,
    route.amountInRaw,
    params
  ]);

  return {
    type: 'flash',
    target: flashExecutorAddress,
    calldata,
    gasLimit
  };
}

module.exports = { buildExecutionPlan, buildFlashExecutionPlan };
