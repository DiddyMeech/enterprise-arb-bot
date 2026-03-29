import { ethers } from "ethers";
import type { EncodedDexLeg, NormalizedDexLeg } from "./types";

const AERODROME_IFACE = new ethers.utils.Interface([
  "function swapExactTokensForTokens(uint256 amountIn,uint256 amountOutMin,(address from,address to,bool stable,address factory)[] routes,address to,uint256 deadline) returns (uint256[] amounts)"
]);

export function encodeAerodromeLeg(leg: NormalizedDexLeg): EncodedDexLeg {
  const factory = String(leg.extra?.factory || ethers.constants.AddressZero);

  const calldata = AERODROME_IFACE.encodeFunctionData("swapExactTokensForTokens", [
    leg.amountInRaw,
    leg.minOutRaw,
    [[leg.tokenIn, leg.tokenOut, !!leg.stable, factory]],
    leg.recipient,
    leg.deadline
  ]);

  return {
    dex: "aerodrome",
    target: leg.target,
    calldata,
    value: "0",
    debug: {
      tokenIn: leg.tokenIn,
      tokenOut: leg.tokenOut,
      stable: !!leg.stable,
      factory
    }
  };
}
