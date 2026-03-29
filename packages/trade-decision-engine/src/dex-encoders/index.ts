import type { EncodedDexLeg, NormalizedDexLeg } from "./types";
import { encodeUniV3Leg } from "./univ3";
import { encodeSushiLeg } from "./sushi";
import { encodeAerodromeLeg } from "./aerodrome";
import { encodeCamelotLeg } from "./camelot";

export * from "./types";

export function encodeDexLeg(leg: NormalizedDexLeg): EncodedDexLeg {
  switch (leg.dex) {
    case "univ3":
      return encodeUniV3Leg(leg);
    case "sushi":
      return encodeSushiLeg(leg);
    case "aerodrome":
      return encodeAerodromeLeg(leg);
    case "camelot":
      return encodeCamelotLeg(leg);
    default:
      throw new Error(`Unsupported dex encoder: ${(leg as any).dex}`);
  }
}
