import { ethers } from "ethers";

export async function getCodeInfo(provider: ethers.providers.Provider, address: string) {
  const code = await provider.getCode(address);
  return {
    address,
    hasCode: code && code !== "0x",
    codeSize: code === "0x" ? 0 : (code.length - 2) / 2
  };
}

export function extractSelector(calldata: string): string {
  if (!calldata || calldata.length < 10) return "0x";
  return calldata.slice(0, 10);
}

export function safeErrorString(error: any): string {
  return (
    error?.reason ||
    error?.error?.reason ||
    error?.message ||
    error?.error?.message ||
    String(error)
  );
}

export function decodeCommonRevert(error: any): string {
  const raw =
    error?.error?.data ||
    error?.data ||
    error?.error?.error?.data;

  if (!raw || typeof raw !== "string") {
    return safeErrorString(error);
  }

  try {
    if (raw.startsWith("0x08c379a0")) {
      const [, reason] = ethers.utils.defaultAbiCoder.decode(["string"], "0x" + raw.slice(10));
      return `Error(${reason})`;
    }
    if (raw.startsWith("0x4e487b71")) {
      const [, code] = ethers.utils.defaultAbiCoder.decode(["uint256"], "0x" + raw.slice(10));
      return `Panic(${code.toString()})`;
    }
  } catch {
    return safeErrorString(error);
  }

  return safeErrorString(error);
}

export function buildSimFailureReport(input: {
  chain: string;
  mode: string;
  executorTarget: string;
  routeHash: string;
  calldata: string;
  legTargets: string[];
  legPayloads: string[];
  amountInRaw: string;
  minOutRaw: string;
  deadline: number;
  decodedReason: string;
}) {
  return {
    chain: input.chain,
    mode: input.mode,
    executorTarget: input.executorTarget,
    routeHash: input.routeHash,
    selector: extractSelector(input.calldata),
    legCount: input.legTargets.length,
    legTargets: input.legTargets,
    outerCalldataLength: input.calldata.length,
    legCalldataLengths: input.legPayloads.map((x) => x.length),
    amountInRaw: input.amountInRaw,
    minOutRaw: input.minOutRaw,
    deadline: input.deadline,
    decodedReason: input.decodedReason
  };
}
