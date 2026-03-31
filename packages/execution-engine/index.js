const { ethers } = require('ethers');

const STANDARD_EXECUTOR_IFACE = new ethers.utils.Interface([
  'function executeArbitrage(address tokenA,address tokenB,uint256 amountIn,address[] calldata routers,uint256[] calldata legMinOuts,uint256 minProfit,uint256 deadline) external returns (uint256)'
]);

const { encodeRoute, validateRouteForEncoding } = require("../executor");

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
  
  const validation = validateRouteForEncoding(route);
  if (!validation.ok) {
    throw new Error(`INVALID_ROUTE_FOR_ENCODING: ${validation.reasons.join(",")}`);
  }

  const encodedRoute = encodeRoute(route);

  const calldata = FLASH_EXECUTOR_IFACE.encodeFunctionData('requestFlashLoan', [
    route.tokenIn,
    route.amountInRaw,
    encodedRoute
  ]);

  return {
    type: 'flash',
    target: flashExecutorAddress,
    calldata,
    gasLimit
  };
}

const { shouldBuildExecution, getExecutionConfig } = require("./should-build-execution");
const {
  isRouteCoolingDown,
  markRouteFailure,
  clearRouteFailure,
  getRouteCooldownKey,
} = require("./route-cooldown");
const {
  getTradingMode,
  shouldPermitLive,
  recordPaperTrade,
  recordLiveTrade,
  recordPaperCandidate,
  recordPaperSummary,
  recordWouldSend,
  recordFamilyAnalytics,
} = require("./trading-mode");
const { checkLiveLimits } = require("./live-limits");

const {
  getRouteFamilyKey,
  markFamilyFailure,
  clearFamilyFailure,
  isFamilyCoolingDown,
  getFamilyFailureState,
} = require("./route-family");

const {
  getSendConfig,
  shouldBroadcastTx,
  buildUnsignedTx,
  simulateUnsignedTx,
  broadcastSignedTx,
} = require("./send-path");

module.exports = {
  buildExecutionPlan,
  buildFlashExecutionPlan,
  shouldBuildExecution,
  getExecutionConfig,
  isRouteCoolingDown,
  markRouteFailure,
  clearRouteFailure,
  getRouteCooldownKey,
  getTradingMode,
  shouldPermitLive,
  recordPaperTrade,
  recordLiveTrade,
  recordPaperCandidate,
  recordPaperSummary,
  recordWouldSend,
  recordFamilyAnalytics,
  checkLiveLimits,
  getRouteFamilyKey,
  markFamilyFailure,
  clearFamilyFailure,
  isFamilyCoolingDown,
  getFamilyFailureState,
  getSendConfig,
  shouldBroadcastTx,
  buildUnsignedTx,
  simulateUnsignedTx,
  broadcastSignedTx,
};
