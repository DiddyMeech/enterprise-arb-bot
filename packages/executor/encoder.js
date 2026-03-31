const { ethers } = require("ethers");

const DEX_TYPE_MAP = {
  v2: 0,
  v3: 1,
};

const ROUTE_TUPLE =
  "tuple(uint8 shape,address tokenIn,uint256 amountIn,uint256 deadline,tuple(uint8 dexType,address router,address tokenIn,address tokenOut,uint256 amountIn,uint256 minOut,uint24 fee)[] legs)";

function normalizeLeg(leg) {
  const dexType = DEX_TYPE_MAP[String(leg.kind || "").toLowerCase()];
  if (dexType === undefined) {
    throw new Error(`UNSUPPORTED_LEG_KIND:${leg.kind}`);
  }

  return [
    dexType,
    leg.router,
    leg.tokenIn,
    leg.tokenOut,
    ethers.BigNumber.from(String(leg.amountInRaw)),
    ethers.BigNumber.from(String(leg.minOutRaw)),
    Number(leg.fee || 0),
  ];
}

function normalizeRoute(route) {
  if (!route || !Array.isArray(route.legs) || route.legs.length === 0) {
    throw new Error("INVALID_ROUTE");
  }

  return [
    Number(route.shape === "3LEG" ? 3 : 2),
    route.tokenIn,
    ethers.BigNumber.from(String(route.amountInRaw)),
    Number(route.deadline),
    route.legs.map(normalizeLeg),
  ];
}

function encodeRoute(route) {
  return ethers.utils.defaultAbiCoder.encode(
    [ROUTE_TUPLE],
    [normalizeRoute(route)]
  );
}

module.exports = {
  encodeRoute,
  normalizeRoute,
  normalizeLeg,
  ROUTE_TUPLE,
};
