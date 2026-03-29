import { ethers } from "ethers";
import type { EncodedDexLeg, NormalizedDexLeg } from "./types";

const UNIV3_IFACE = new ethers.utils.Interface([
  "function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 deadline,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)"
]);

export function encodeUniV3Leg(leg: NormalizedDexLeg): EncodedDexLeg {
  if (!leg.feeTier) {
    throw new Error("UniswapV3 leg missing feeTier");
  }

  const calldata = UNIV3_IFACE.encodeFunctionData("exactInputSingle", [[
    leg.tokenIn,
    leg.tokenOut,
    leg.feeTier,
    leg.recipient,
    leg.deadline,
    leg.amountInRaw,
    leg.minOutRaw,
    0
  ]]);

  return {
    dex: "univ3",
    target: leg.target,
    tokenIn: leg.tokenIn,
    tokenOut: leg.tokenOut,
    calldata,
    value: "0",
    debug: {
      tokenIn: leg.tokenIn,
      tokenOut: leg.tokenOut,
      feeTier: leg.feeTier,
      amountInRaw: leg.amountInRaw,
      minOutRaw: leg.minOutRaw
    }
  };
}
