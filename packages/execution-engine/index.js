const { ethers } = require('ethers');

const EXECUTOR_IFACE = new ethers.utils.Interface([
  'function executeArbitrage(address tokenA,address tokenB,uint256 amountIn,address[] calldata routers,uint256[] calldata legMinOuts,uint256 minProfit,uint256 deadline) external returns (uint256)'
]);

function buildExecutionPlan({ executorAddress, route, gasLimit = 700000 }) {
  if (!executorAddress) {
    throw new Error('MISSING_EXECUTOR_ADDRESS');
  }

  if (!route || !Array.isArray(route.legs) || route.legs.length < 2) {
    throw new Error('INVALID_ROUTE');
  }

  const routers = route.legs.map((leg) => leg.router);
  const legMinOuts = route.legs.map((leg) => leg.minOutRaw);

  const calldata = EXECUTOR_IFACE.encodeFunctionData('executeArbitrage', [
    route.tokenIn,
    route.tokenOut,
    route.amountInRaw,
    routers,
    legMinOuts,
    route.minProfitTokenRaw || '1',
    route.deadline
  ]);

  return {
    target: executorAddress,
    calldata,
    gasLimit
  };
}

module.exports = {
  buildExecutionPlan,
  EXECUTOR_IFACE
};
