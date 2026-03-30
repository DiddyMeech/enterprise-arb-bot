/**
 * camelot-guard.ts
 *
 * Keeps Camelot routes disabled until:
 *   1. CAMELOT_ENABLED=true is set explicitly in env
 *   2. A valid 42-char 0x router address is provided
 *   3. The route is on Arbitrum (the only chain Camelot is deployed on)
 *
 * This prevents accidental Camelot execution with stale or wrong addresses.
 */

export type CamelotConfig = {
  enabled:   boolean;
  router?:   string;
  referrer?: string;
};

type ValidateResult =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Validates that a CamelotConfig is fully formed and explicit.
 * Returns { ok: false } with a reason if anything is missing or malformed.
 */
export function validateCamelotConfig(cfg: CamelotConfig): ValidateResult {
  if (!cfg.enabled) {
    return { ok: false, reason: "CAMELOT_DISABLED" };
  }

  if (!cfg.router || !cfg.router.startsWith("0x") || cfg.router.length !== 42) {
    return { ok: false, reason: "CAMELOT_ROUTER_MISSING_OR_INVALID" };
  }

  if (cfg.referrer && (!cfg.referrer.startsWith("0x") || cfg.referrer.length !== 42)) {
    return { ok: false, reason: "CAMELOT_REFERRER_INVALID" };
  }

  return { ok: true };
}

/**
 * Returns { ok: true } if:
 *   - the route does not involve Camelot at all, OR
 *   - the route involves Camelot, is on Arbitrum, and the config is valid.
 *
 * Returns { ok: false } otherwise, with a reason string.
 */
export function shouldEnableCamelotRoute(input: {
  chain:   string;
  dexBuy:  string;
  dexSell: string;
  camelot: CamelotConfig;
}): ValidateResult {
  const touchesCamelot = input.dexBuy === "camelot" || input.dexSell === "camelot";

  if (!touchesCamelot) {
    return { ok: true };
  }

  if (input.chain !== "arbitrum") {
    return { ok: false, reason: "CAMELOT_ONLY_ALLOWED_ON_ARBITRUM" };
  }

  return validateCamelotConfig(input.camelot);
}

/**
 * Convenience helper — reads config from process.env.
 * Used by orchestrator intake and validation scripts.
 */
export function getCamelotConfigFromEnv(): CamelotConfig {
  return {
    enabled:  process.env.CAMELOT_ENABLED === "true",
    router:   process.env.CAMELOT_ROUTER,
    referrer: process.env.CAMELOT_REFERRER,
  };
}
