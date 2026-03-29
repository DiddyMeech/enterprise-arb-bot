export type RouteLeg = {
  target: string;
  calldata: string;
};

export type ExecutionPlan = {
  target: string;
  calldata: string;
  targets: string[];
  payloads: string[];
  gasLimit: number;
};

export function buildExecutionPlan(input: {
  executorAddress: string;
  routeLegs: RouteLeg[];
  minOutRaw: string;
  deadline: number;
  amountInRaw: string;
  tokenIn: string;
}): ExecutionPlan {
  if (!input.routeLegs.length) {
    throw new Error("Cannot build execution plan with zero route legs");
  }

  return {
    target: input.executorAddress,
    calldata: "0x", // replace with actual encoded executor call
    targets: input.routeLegs.map((x) => x.target),
    payloads: input.routeLegs.map((x) => x.calldata),
    gasLimit: 500000,
  };
}
