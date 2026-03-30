/**
 * route-family-key.ts
 *
 * Canonical key format for a route family used across the shadow tracker,
 * route-priority scorer, and log events.
 *
 * Format: "<dexBuy>-><dexSell>:<tokenIn>/<tokenOut>"
 * Example: "sushi->univ3:USDC/WETH"
 */

export function routeFamilyKey(input: {
  dexBuy:  string;
  dexSell: string;
  tokenIn: string;
  tokenOut: string;
}): string {
  return `${input.dexBuy}->${input.dexSell}:${input.tokenIn}/${input.tokenOut}`;
}
