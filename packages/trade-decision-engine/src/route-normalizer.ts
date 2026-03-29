import type { NormalizedDexLeg, SupportedDex } from "./dex-encoders";

export type RawRouteLegInput = {
  dex: SupportedDex;
  router: string;
  tokenIn: string;
  tokenOut: string;
  recipient: string;
  amountInRaw: string;
  minOutRaw: string;
  feeTier?: number;
  stable?: boolean;
  extra?: Record<string, unknown>;
};

export type RawRouteInput = {
  legs: RawRouteLegInput[];
  deadline: number;
};

export function normalizeRoute(raw: RawRouteInput): NormalizedDexLeg[] {
  if (!raw.legs?.length) {
    throw new Error("Cannot normalize route with zero legs");
  }

  return raw.legs.map((leg, idx) => {
    if (!leg.router) throw new Error(`Route leg ${idx} missing router`);
    if (!leg.tokenIn || !leg.tokenOut) throw new Error(`Route leg ${idx} missing token`);
    if (!leg.amountInRaw) throw new Error(`Route leg ${idx} missing amountInRaw`);
    if (!leg.recipient) throw new Error(`Route leg ${idx} missing recipient`);

    return {
      dex: leg.dex,
      target: leg.router,
      tokenIn: leg.tokenIn,
      tokenOut: leg.tokenOut,
      recipient: leg.recipient,
      amountInRaw: leg.amountInRaw,
      minOutRaw: leg.minOutRaw,
      feeTier: leg.feeTier,
      stable: leg.stable,
      deadline: raw.deadline,
      extra: leg.extra
    };
  });
}
