import { encodeExecutorCall, type ExecutorMode } from "./executor-abi";
import type { NormalizedDexLeg } from "./dex-encoders";

export type CanonicalRoutePlan = {
  chain: "arbitrum" | "base";
  tokenIn: string;
  tokenOut: string;
  amountInRaw: string;
  minProfitTokenRaw: string;
  minOutRaw: string;
  deadline: number;
  legs: Array<{
    target: string;
    value?: string;
    calldata: string;
    dex: string;
    tokenIn: string;
    tokenOut: string;
  }>;
};

export type BuiltExecutionPlan = {
  mode: ExecutorMode;
  target: string;
  calldata: string;
  targets: string[];
  payloads: string[];
  values: string[];
  gasLimit: number;
  routeHash: string;
};

export function computeRouteHash(route: CanonicalRoutePlan): string {
  return JSON.stringify({
    chain: route.chain,
    tokenIn: route.tokenIn,
    tokenOut: route.tokenOut,
    amountInRaw: route.amountInRaw,
    minOutRaw: route.minOutRaw,
    deadline: route.deadline,
    legs: route.legs.map((x) => ({
      target: x.target,
      dex: x.dex,
      tokenIn: x.tokenIn,
      tokenOut: x.tokenOut,
      calldata: x.calldata
    }))
  });
}

export function buildExecutionPlan(input: {
  executorAddress: string;
  mode: ExecutorMode;
  route: CanonicalRoutePlan;
  gasLimit?: number;
}): BuiltExecutionPlan {
  if (!input.route.legs?.length) {
    throw new Error("Route has no encoded legs");
  }

  const targets = input.route.legs.map((x) => x.target);
  const payloads = input.route.legs.map((x) => x.calldata);
  const values = input.route.legs.map((x) => x.value ?? "0");

  const calldata = encodeExecutorCall({
    mode: input.mode,
    tokenIn: input.route.tokenIn,
    amountInRaw: input.route.amountInRaw,
    minOutRaw: input.route.minOutRaw,
    deadline: input.route.deadline,
    targets,
    payloads
  });

  return {
    mode: input.mode,
    target: input.executorAddress,
    calldata,
    targets,
    payloads,
    values,
    gasLimit: input.gasLimit ?? 700000,
    routeHash: computeRouteHash(input.route)
  };
}
