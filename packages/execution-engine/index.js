const { ethers } = require('ethers');

const STANDARD_EXECUTOR_IFACE = new ethers.utils.Interface([
  'function executeArbitrage(address tokenA,address tokenB,uint256 amountIn,address[] calldata routers,uint256[] calldata legMinOuts,uint256 minProfit,uint256 deadline) external returns (uint256)'
]);

const FLASH_EXECUTOR_IFACE = new ethers.utils.Interface([
  'function requestFlashLoan(address asset,uint256 amount,bytes calldata params) external'
]);

function buildExecutionPlan({ executorAddress, route, gasLimit = 900000 }) {
  if (!executorAddress) throw new Error('MISSING_EXECUTOR_ADDRESS');
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

function buildFlashExecutionPlan({
  flashExecutorAddress,
  route,
  gasLimit = 1300000
}) {
  if (!flashExecutorAddress) throw new Error('MISSING_FLASH_EXECUTOR_ADDRESS');
  if (!route || !Array.isArray(route.legs) || route.legs.length < 2) {
    throw new Error('INVALID_ROUTE');
  }

  const flashRoute = {
    profitToken: route.tokenIn,
    minProfitRaw: route.minProfitTokenRaw || '1',
    deadline: route.deadline,
    legs: route.legs.map((leg) => ({
      dexKind: leg.kind === 'v3' ? 1 : 0,
      router: leg.router,
      tokenIn: leg.tokenIn,
      tokenOut: leg.tokenOut,
      amountInRaw: leg.amountInRaw,
      minOutRaw: leg.minOutRaw,
      fee: leg.fee || 0
    }))
  };

  const params = ethers.utils.defaultAbiCoder.encode(
    [
      'tuple(address profitToken,uint256 minProfitRaw,uint256 deadline,tuple(uint8 dexKind,address router,address tokenIn,address tokenOut,uint256 amountInRaw,uint256 minOutRaw,uint24 fee)[] legs)'
    ],
    [flashRoute]
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

module.exports = {
  buildExecutionPlan,
  buildFlashExecutionPlan
};
