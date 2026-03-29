import { ethers } from "ethers";
import type { EncodedDexLeg, NormalizedDexLeg } from "./types";

const SUSHI_IFACE = new ethers.utils.Interface([
  "function swapExactTokensForTokens(uint256 amountIn,uint256 amountOutMin,address[] path,address to,uint256 deadline) returns (uint256[] amounts)"
]);

export function encodeSushiLeg(leg: NormalizedDexLeg): EncodedDexLeg {
  const calldata = SUSHI_IFACE.encodeFunctionData("swapExactTokensForTokens", [
    leg.amountInRaw,
    leg.minOutRaw,
    [leg.tokenIn, leg.tokenOut],
    leg.recipient,
    leg.deadline
  ]);

  return {
    dex: "sushi",
    target: leg.target,
    tokenIn: leg.tokenIn,
    tokenOut: leg.tokenOut,
    calldata,
    value: "0",
    debug: {
      tokenIn: leg.tokenIn,
      tokenOut: leg.tokenOut,
      amountInRaw: leg.amountInRaw,
      minOutRaw: leg.minOutRaw
    }
  };
}
