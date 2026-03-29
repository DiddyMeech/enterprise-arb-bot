import { ethers } from "ethers";
import type { EncodedDexLeg, NormalizedDexLeg } from "./types";

const CAMELOT_IFACE = new ethers.utils.Interface([
  "function swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256 amountIn,uint256 amountOutMin,address[] path,address to,address referrer,uint256 deadline)"
]);

export function encodeCamelotLeg(leg: NormalizedDexLeg): EncodedDexLeg {
  const referrer = String(leg.extra?.referrer || ethers.constants.AddressZero);

  const calldata = CAMELOT_IFACE.encodeFunctionData("swapExactTokensForTokensSupportingFeeOnTransferTokens", [
    leg.amountInRaw,
    leg.minOutRaw,
    [leg.tokenIn, leg.tokenOut],
    leg.recipient,
    referrer,
    leg.deadline
  ]);

  return {
    dex: "camelot",
    target: leg.target,
    tokenIn: leg.tokenIn,
    tokenOut: leg.tokenOut,
    calldata,
    value: "0",
    debug: {
      tokenIn: leg.tokenIn,
      tokenOut: leg.tokenOut,
      referrer
    }
  };
}
