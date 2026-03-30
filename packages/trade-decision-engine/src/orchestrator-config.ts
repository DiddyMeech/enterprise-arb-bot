// orchestrator-config.ts

import { OrchestratorConfig } from "./engine-orchestrator";

export const ORCHESTRATOR_CONFIG: OrchestratorConfig = {
  mode: "live",
  minScoreToSend: 40,
  maxQuoteAgeMs: 900,
  quarantineAfterConsecutiveFailures: 4,
  quarantineMs: 10 * 60 * 1000,
  perChainConcurrency: {
    arbitrum: 3,
    base: 4,
  },
  replayEnabled: true,
  killSwitches: {
    maxConsecutiveSendFailures: 8,
    maxConsecutiveReverts: 5,
    maxRecentFailureRate: 0.65,
    failureWindowSize: 20,
  },
  flashLoanPremiumRefreshMs: 5 * 60 * 1000,
  circuitResetMs: 5 * 60 * 1000, // auto-reset tripped circuits after 5 min
};
