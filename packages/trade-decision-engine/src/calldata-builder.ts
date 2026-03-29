import { ethers } from "ethers";

export type NormalizedRouteLeg = {
  target: string;
  value?: string;
  calldata: string;
  dex: string;
  tokenIn: string;
  tokenOut: string;
};

export type ExecutionMode = "wallet" | "flash";

export type CanonicalRoutePlan = {
  chain: "arbitrum" | "base";
  tokenIn: string;
  tokenOut: string;
  amountInRaw: string;
  minProfitTokenRaw: string;
  minOutRaw: string;
  deadline: number;
  legs: NormalizedRouteLeg[];
};

export type BuiltExecutionPlan = {
  mode: ExecutionMode;
  target: string;
  calldata: string;
  targets: string[];
  payloads: string[];
  values: string[];
  gasLimit: number;
  routeHash: string;
};

const EXECUTOR_IFACE = new ethers.utils.Interface([
  "function executeArbitrage(address tokenIn,uint256 amountIn,uint256 minOut,uint256 deadline,address[] calldata targets,bytes[] calldata payloads)",
  "function executeFlashArbitrage(address tokenIn,uint256 amountIn,uint256 minOut,uint256 deadline,address[] calldata targets,bytes[] calldata payloads)"
]);

function assertRoute(route: CanonicalRoutePlan): void {
  if (!route.legs?.length) {
    throw new Error("Route has no legs");
  }
  if (!route.tokenIn || !route.amountInRaw || !route.minOutRaw) {
    throw new Error("Route missing required execution fields");
  }
  for (const [i, leg] of route.legs.entries()) {
    if (!leg.target || !leg.calldata) {
      throw new Error(`Route leg ${i} is incomplete`);
    }
  }
}

export function computeRouteHash(route: CanonicalRoutePlan): string {
  return ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(
      [
        "string",
        "address",
        "address",
        "uint256",
        "uint256",
        "uint256",
        "tuple(address target,uint256 value,bytes calldata,string dex,address tokenIn,address tokenOut)[]"
      ],
      [
        route.chain,
        route.tokenIn,
        route.tokenOut,
        route.amountInRaw,
        route.minOutRaw,
        route.deadline,
        route.legs.map((leg) => ({
          target: leg.target,
          value: leg.value ?? "0",
          calldata: leg.calldata,
          dex: leg.dex,
          tokenIn: leg.tokenIn,
          tokenOut: leg.tokenOut
        }))
      ]
    )
  );
}

export function buildExecutionPlan(input: {
  executorAddress: string;
  mode: ExecutionMode;
  route: CanonicalRoutePlan;
  gasLimit?: number;
}): BuiltExecutionPlan {
  const { executorAddress, mode, route } = input;
  assertRoute(route);

  const targets = route.legs.map((x) => x.target);
  const payloads = route.legs.map((x) => x.calldata);
  const values = route.legs.map((x) => x.value ?? "0");

  const calldata =
    mode === "flash"
      ? EXECUTOR_IFACE.encodeFunctionData("executeFlashArbitrage", [
          route.tokenIn,
          route.amountInRaw,
          route.minOutRaw,
          route.deadline,
          targets,
          payloads
        ])
      : EXECUTOR_IFACE.encodeFunctionData("executeArbitrage", [
          route.tokenIn,
          route.amountInRaw,
          route.minOutRaw,
          route.deadline,
          targets,
          payloads
        ]);

  return {
    mode,
    target: executorAddress,
    calldata,
    targets,
    payloads,
    values,
    gasLimit: input.gasLimit ?? 700000,
    routeHash: computeRouteHash(route)
  };
}
