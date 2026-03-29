export type SupportedDex = "univ3" | "sushi" | "aerodrome" | "camelot";

export type NormalizedDexLeg = {
  dex: SupportedDex;
  target: string;
  tokenIn: string;
  tokenOut: string;
  recipient: string;
  amountInRaw: string;
  minOutRaw: string;
  feeTier?: number;
  stable?: boolean;
  deadline: number;
  extra?: Record<string, unknown>;
};

export type EncodedDexLeg = {
  dex: SupportedDex;
  target: string;
  tokenIn: string;
  tokenOut: string;
  calldata: string;
  value: string;
  debug: Record<string, unknown>;
};
