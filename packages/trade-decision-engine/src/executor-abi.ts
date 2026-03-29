import { ethers } from "ethers";

export const EXECUTOR_ABI = [
  "function executeArbitrage(address tokenIn,uint256 amountIn,uint256 minOut,uint256 deadline,address[] calldata targets,bytes[] calldata payloads)",
  "function executeFlashArbitrage(address tokenIn,uint256 amountIn,uint256 minOut,uint256 deadline,address[] calldata targets,bytes[] calldata payloads)"
] as const;

export const EXECUTOR_IFACE = new ethers.utils.Interface([...EXECUTOR_ABI]);

export type ExecutorMode = "wallet" | "flash";

export function getExecutorFunctionName(mode: ExecutorMode): string {
  return mode === "flash" ? "executeFlashArbitrage" : "executeArbitrage";
}

export function getSelector(mode: ExecutorMode): string {
  return EXECUTOR_IFACE.getSighash(getExecutorFunctionName(mode));
}

export function encodeExecutorCall(input: {
  mode: ExecutorMode;
  tokenIn: string;
  amountInRaw: string;
  minOutRaw: string;
  deadline: number;
  targets: string[];
  payloads: string[];
}): string {
  return EXECUTOR_IFACE.encodeFunctionData(getExecutorFunctionName(input.mode), [
    input.tokenIn,
    input.amountInRaw,
    input.minOutRaw,
    input.deadline,
    input.targets,
    input.payloads
  ]);
}
