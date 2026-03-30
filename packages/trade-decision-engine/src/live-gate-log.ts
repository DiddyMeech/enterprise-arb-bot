/**
 * live-gate-log.ts
 *
 * Thin structured logger for live gate pass/block events.
 * Accepts any logger interface with a compatible info() signature,
 * so it works with EngineLogger or a plain console shim.
 */

export type LiveGateLogInput = {
  ok:              boolean;
  reason:          string;
  opportunityId?:  string;
  routeHash?:      string;
  routeFamily?:    string;
  details?:        Record<string, unknown>;
};

export function logLiveGate(
  logger: { info: (event: string, payload?: Record<string, unknown>) => void },
  input: LiveGateLogInput,
): void {
  const event = input.ok ? "LIVE_GATE_PASS" : "LIVE_GATE_BLOCK";
  logger.info(event, {
    reason:        input.reason,
    opportunityId: input.opportunityId,
    routeHash:     input.routeHash,
    routeFamily:   input.routeFamily,
    ...(input.details ?? {}),
  });
}
