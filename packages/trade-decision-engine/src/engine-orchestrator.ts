// engine-orchestrator.ts

import {
  Opportunity,
  EvaluationResult,
  RouteMemory,
  processOpportunity,
  EvaluateDeps,
} from "./execution-engine";

import {
  classifyFailure,
  FailureReason,
} from "./failure-classifier";

import {
  EngineLogger,
  recordFailureMetrics,
  recordOpportunityMetrics,
  recordSuccessMetrics,
} from "./logger";

export type ChainName = "arbitrum" | "base";
export type WorkerMode = "shadow" | "live";

export type ReplayRecord = {
  ts: string;
  opportunity: Opportunity;
  evaluation?: EvaluationResult;
  phase: "detected" | "prefilter" | "quote" | "simulate" | "send" | "receipt";
  failure?: FailureReason | string;
  details?: Record<string, unknown>;
};

export type ExecutionCandidate = {
  evaluation: EvaluationResult;
  rawOpportunity: Opportunity;
};

export type SendResult = {
  ok: boolean;
  txHash?: string;
  error?: unknown;
  decodedReason?: string;
  revertData?: string;
};

export type ReceiptResult = {
  ok: boolean;
  txHash: string;
  realizedProfitUsd?: number;
  gasUsd?: number;
  reverted?: boolean;
  error?: unknown;
};

export type OrchestratorDeps = EvaluateDeps & {
  sendExecution: (candidate: ExecutionCandidate) => Promise<SendResult>;
  waitForReceipt: (txHash: string, chain: ChainName) => Promise<ReceiptResult>;
  fetchFlashLoanPremiumBps?: (chain: ChainName) => Promise<number>;
  persistReplay?: (record: ReplayRecord) => Promise<void>;
  nowMs?: () => number;
};

export type RouteKey = string;

export type RouteQuarantineEntry = {
  failures: number;
  lastFailureTs: number;
  quarantinedUntilTs?: number;
  lastReason?: FailureReason | string;
};

export type CircuitState = {
  open: boolean;
  reason?: string;
  openedAt?: number;
};

export type OrchestratorConfig = {
  mode: WorkerMode;
  minScoreToSend: number;
  maxQuoteAgeMs: number;
  quarantineAfterConsecutiveFailures: number;
  quarantineMs: number;
  perChainConcurrency: Record<ChainName, number>;
  replayEnabled: boolean;
  killSwitches: {
    maxConsecutiveSendFailures: number;
    maxConsecutiveReverts: number;
    maxRecentFailureRate: number; // 0..1
    failureWindowSize: number;
  };
  flashLoanPremiumRefreshMs: number;
  /** How long (ms) before an open circuit auto-resets. Default: 5 min. */
  circuitResetMs: number;
};

export class ChainWorkerQueue {
  private running = 0;
  private readonly queue: Array<() => Promise<void>> = [];

  constructor(private readonly concurrency: number) {}

  push(job: () => Promise<void>) {
    this.queue.push(job);
    this.pump();
  }

  private pump() {
    while (this.running < this.concurrency && this.queue.length > 0) {
      const job = this.queue.shift()!;
      this.running++;
      job()
        .catch(() => undefined)
        .finally(() => {
          this.running--;
          this.pump();
        });
    }
  }
}

export class ArbOrchestrator {
  private readonly logger: EngineLogger;
  private readonly memory = new RouteMemory();

  private readonly queues: Record<ChainName, ChainWorkerQueue>;
  private readonly quarantine = new Map<RouteKey, RouteQuarantineEntry>();
  private readonly circuit: Record<ChainName, CircuitState> = {
    arbitrum: { open: false },
    base: { open: false },
  };

  private readonly recentFailures: Record<ChainName, boolean[]> = {
    arbitrum: [],
    base: [],
  };

  private readonly consecutiveSendFailures: Record<ChainName, number> = {
    arbitrum: 0,
    base: 0,
  };

  private readonly consecutiveReverts: Record<ChainName, number> = {
    arbitrum: 0,
    base: 0,
  };

  private flashLoanPremiumBps: Partial<Record<ChainName, number>> = {};

  constructor(
    private readonly cfg: OrchestratorConfig,
    private readonly deps: OrchestratorDeps,
    logger?: EngineLogger,
  ) {
    this.logger =
      logger ??
      new EngineLogger({
        service: "arb-orchestrator",
        minLevel: "info",
        json: true,
      });

    this.queues = {
      arbitrum: new ChainWorkerQueue(cfg.perChainConcurrency.arbitrum),
      base: new ChainWorkerQueue(cfg.perChainConcurrency.base),
    };
  }

  startBackgroundTasks() {
    if (this.deps.fetchFlashLoanPremiumBps) {
      this.refreshFlashLoanPremiums().catch(() => undefined);
      setInterval(() => {
        this.refreshFlashLoanPremiums().catch(() => undefined);
      }, this.cfg.flashLoanPremiumRefreshMs);
    }

    // Auto-reset any tripped circuit breakers after circuitResetMs cooldown
    const resetMs = this.cfg.circuitResetMs ?? 5 * 60 * 1000;
    setInterval(() => {
      const now = this.now();
      for (const chain of ["arbitrum", "base"] as const) {
        const state = this.circuit[chain];
        if (state.open && state.openedAt !== undefined && now - state.openedAt >= resetMs) {
          this.resetCircuit(chain);
        }
      }
    }, Math.min(resetMs, 60_000)); // check at most every 60s
  }

  submitOpportunity(opp: Opportunity) {
    this.queues[opp.chain].push(async () => {
      await this.handleOpportunity(opp);
    });
  }

  private async handleOpportunity(opp: Opportunity) {
    const now = this.now();
    recordOpportunityMetrics(this.logger, opp.chain);

    this.logger.info("OPPORTUNITY_DETECTED", {
      chain: opp.chain,
      opportunityId: opp.id,
      tokenIn: opp.tokenIn,
      tokenOut: opp.tokenOut,
      dexBuy: opp.dexBuy,
      dexSell: opp.dexSell,
      grossProfitUsd: opp.quotedGrossProfitUsd,
      gasUsd: opp.estimatedGasUsd,
      blockSeen: opp.blockNumberSeen,
      blockNow: opp.currentBlockNumber,
      latencyMs: now - opp.quoteTimestampMs,
    });

    await this.persistReplay({
      ts: new Date(now).toISOString(),
      opportunity: opp,
      phase: "detected",
    });

    if (this.circuit[opp.chain].open) {
      this.logger.warn("PREFILTER_REJECT", {
        chain: opp.chain,
        opportunityId: opp.id,
        failure: "CIRCUIT_OPEN",
        reason: this.circuit[opp.chain].reason,
      });
      return;
    }

    if (this.isTooStale(opp, now)) {
      this.logger.warn("PREFILTER_REJECT", {
        chain: opp.chain,
        opportunityId: opp.id,
        failure: "TOO_LATE_TO_SEND",
        latencyMs: now - opp.quoteTimestampMs,
      });
      recordFailureMetrics(this.logger, "TOO_LATE_TO_SEND", opp.chain);
      await this.persistReplay({
        ts: new Date(now).toISOString(),
        opportunity: opp,
        phase: "prefilter",
        failure: "TOO_LATE_TO_SEND",
        details: { latencyMs: now - opp.quoteTimestampMs },
      });
      this.registerFailure(opp.chain, "TOO_LATE_TO_SEND");
      return;
    }

    const rk = this.routeKey(opp);
    if (this.isRouteQuarantined(rk, now)) {
      this.logger.warn("PREFILTER_REJECT", {
        chain: opp.chain,
        opportunityId: opp.id,
        failure: "ROUTE_QUARANTINED",
      });
      return;
    }

    const evaluation = await processOpportunity(
      opp,
      {
        ...this.deps,
        log: (msg, payload) => {
          if (msg.includes("SIM_FAIL")) {
            this.logger.warn("SIM_FAIL", {
              chain: opp.chain,
              opportunityId: opp.id,
              ...(payload as Record<string, unknown>),
            });
          } else if (msg.includes("QUOTE_FAIL")) {
            this.logger.warn("QUOTE_FAIL", {
              chain: opp.chain,
              opportunityId: opp.id,
              ...(payload as Record<string, unknown>),
            });
          } else if (msg.includes("NET_FAIL")) {
            this.logger.info("NET_FAIL", {
              chain: opp.chain,
              opportunityId: opp.id,
              ...(payload as Record<string, unknown>),
            });
          }
        },
      },
      this.memory,
    );

    await this.persistReplay({
      ts: new Date(this.now()).toISOString(),
      opportunity: opp,
      phase: "simulate",
      evaluation,
      failure: evaluation.ok ? undefined : evaluation.reason,
      details: evaluation.diagnostics as Record<string, unknown> | undefined,
    });

    if (!evaluation.ok) {
      const classified = classifyFailure({
        phase: "simulate",
        reason: evaluation.reason,
      });

      this.logger.warn("SIM_FAIL", {
        chain: opp.chain,
        opportunityId: opp.id,
        failure: classified.failure,
        reason: evaluation.reason,
      });

      recordFailureMetrics(this.logger, classified.failure, opp.chain);
      this.registerFailure(opp.chain, classified.failure);
      this.bumpQuarantine(rk, classified.failure);
      return;
    }

    if ((evaluation.score ?? 0) < this.cfg.minScoreToSend) {
      this.logger.info("PREFILTER_REJECT", {
        chain: opp.chain,
        opportunityId: opp.id,
        failure: "SCORE_TOO_LOW",
        score: evaluation.score,
      });
      return;
    }

    if (this.cfg.mode === "shadow") {
      this.logger.info("EXECUTE_ATTEMPT", {
        chain: opp.chain,
        opportunityId: opp.id,
        mode: evaluation.mode,
        amountInUsd: evaluation.bestSizeUsd,
        netProfitUsd: evaluation.netProfitUsd,
        score: evaluation.score,
        shadow: true,
      });
      return;
    }

    await this.sendAndTrack({
      evaluation,
      rawOpportunity: opp,
    });
  }

  private async sendAndTrack(candidate: ExecutionCandidate) {
    const { evaluation, rawOpportunity: opp } = candidate;

    this.logger.info("EXECUTE_ATTEMPT", {
      chain: opp.chain,
      opportunityId: opp.id,
      mode: evaluation.mode,
      amountInUsd: evaluation.bestSizeUsd,
      netProfitUsd: evaluation.netProfitUsd,
      score: evaluation.score,
    });

    const send = await this.deps.sendExecution(candidate);

    if (!send.ok || !send.txHash) {
      const classified = classifyFailure({
        phase: "send",
        reason: "SEND_FAILED",
        decodedReason: send.decodedReason,
        revertData: send.revertData,
        rawError: send.error,
      });

      this.logger.error("EXECUTE_FAIL", {
        chain: opp.chain,
        opportunityId: opp.id,
        failure: classified.failure,
        mode: evaluation.mode,
      });

      recordFailureMetrics(this.logger, classified.failure, opp.chain);
      await this.persistReplay({
        ts: new Date(this.now()).toISOString(),
        opportunity: opp,
        evaluation,
        phase: "send",
        failure: classified.failure,
      });

      this.registerFailure(opp.chain, classified.failure, "send");
      this.bumpQuarantine(this.routeKey(opp), classified.failure);
      return;
    }

    this.consecutiveSendFailures[opp.chain] = 0;

    this.logger.info("EXECUTE_SENT", {
      chain: opp.chain,
      opportunityId: opp.id,
      txHash: send.txHash,
      mode: evaluation.mode,
    });

    const receipt = await this.deps.waitForReceipt(send.txHash, opp.chain);

    if (!receipt.ok || receipt.reverted) {
      const classified = classifyFailure({
        phase: "receipt",
        reason: receipt.reverted ? "REVERTED" : "RECEIPT_FAILED",
        rawError: receipt.error,
      });

      this.logger.error("EXECUTE_REVERTED", {
        chain: opp.chain,
        opportunityId: opp.id,
        txHash: send.txHash,
        failure: classified.failure,
      });

      recordFailureMetrics(this.logger, classified.failure, opp.chain);
      await this.persistReplay({
        ts: new Date(this.now()).toISOString(),
        opportunity: opp,
        evaluation,
        phase: "receipt",
        failure: classified.failure,
        details: { txHash: send.txHash },
      });

      this.registerFailure(opp.chain, classified.failure, "receipt");
      this.bumpQuarantine(this.routeKey(opp), classified.failure);
      return;
    }

    this.recentFailures[opp.chain].push(false);
    this.trimFailureWindow(opp.chain);
    this.consecutiveReverts[opp.chain] = 0;

    this.logger.info("EXECUTE_CONFIRMED", {
      chain: opp.chain,
      opportunityId: opp.id,
      txHash: send.txHash,
      netProfitUsd: evaluation.netProfitUsd,
      realizedProfitUsd: receipt.realizedProfitUsd,
      gasUsd: receipt.gasUsd,
      mode: evaluation.mode,
    });

    recordSuccessMetrics(this.logger, opp.chain, evaluation.mode);
  }

  private isTooStale(opp: Opportunity, now: number): boolean {
    return now - opp.quoteTimestampMs > this.cfg.maxQuoteAgeMs;
  }

  private routeKey(opp: Opportunity): RouteKey {
    return `${opp.chain}:${opp.tokenIn}:${opp.tokenOut}:${opp.dexBuy}:${opp.dexSell}`;
  }

  private isRouteQuarantined(key: RouteKey, now: number): boolean {
    const entry = this.quarantine.get(key);
    if (!entry?.quarantinedUntilTs) return false;
    if (entry.quarantinedUntilTs <= now) {
      this.quarantine.delete(key);
      return false;
    }
    return true;
  }

  private bumpQuarantine(key: RouteKey, reason: FailureReason | string) {
    const now = this.now();
    const current = this.quarantine.get(key) ?? {
      failures: 0,
      lastFailureTs: now,
    };

    current.failures += 1;
    current.lastFailureTs = now;
    current.lastReason = reason;

    if (current.failures >= this.cfg.quarantineAfterConsecutiveFailures) {
      current.quarantinedUntilTs = now + this.cfg.quarantineMs;
    }

    this.quarantine.set(key, current);
  }

  /**
   * phase: "send" = tx never left the node (nonce, rpc, gas estimation issues)
   *         "receipt" = tx mined but reverted on-chain
   * Only send-phase failures count toward consecutiveSendFailures to avoid
   * double-tripping the kill switch when a route reverts on-chain.
   */
  private registerFailure(
    chain: ChainName,
    failure: FailureReason | string,
    phase: "send" | "receipt" | "other" = "other",
  ) {
    this.recentFailures[chain].push(true);
    this.trimFailureWindow(chain);

    // Only pre-broadcast failures count as send failures
    if (phase === "send") {
      this.consecutiveSendFailures[chain] += 1;
    }

    // On-chain reverts count as revert failures (separate counter)
    if (
      phase === "receipt" ||
      failure === "REVERTED_OR_IMPOSSIBLE" ||
      failure === "CALLBACK_FAILED" ||
      failure === "ASSET_NOT_RETURNED" ||
      failure === "INSUFFICIENT_OUTPUT_AMOUNT"
    ) {
      this.consecutiveReverts[chain] += 1;
    }

    const recent = this.recentFailures[chain];
    const rate =
      recent.length === 0
        ? 0
        : recent.filter(Boolean).length / recent.length;

    if (
      this.consecutiveSendFailures[chain] >=
      this.cfg.killSwitches.maxConsecutiveSendFailures
    ) {
      this.openCircuit(
        chain,
        `max consecutive send failures hit: ${this.consecutiveSendFailures[chain]}`,
      );
    }

    if (
      this.consecutiveReverts[chain] >=
      this.cfg.killSwitches.maxConsecutiveReverts
    ) {
      this.openCircuit(
        chain,
        `max consecutive reverts hit: ${this.consecutiveReverts[chain]}`,
      );
    }

    if (
      recent.length >= this.cfg.killSwitches.failureWindowSize &&
      rate >= this.cfg.killSwitches.maxRecentFailureRate
    ) {
      this.openCircuit(
        chain,
        `recent failure rate too high: ${rate.toFixed(2)}`,
      );
    }
  }

  private trimFailureWindow(chain: ChainName) {
    const window = this.recentFailures[chain];
    const max = this.cfg.killSwitches.failureWindowSize;
    while (window.length > max) window.shift();
  }

  private openCircuit(chain: ChainName, reason: string) {
    this.circuit[chain] = {
      open: true,
      reason,
      openedAt: this.now(),
    };

    this.logger.error("LEARN_UPDATE", {
      chain,
      eventType: "CIRCUIT_OPENED",
      reason,
    });
  }

  resetCircuit(chain: ChainName) {
    this.circuit[chain] = { open: false };
    this.consecutiveSendFailures[chain] = 0;
    this.consecutiveReverts[chain] = 0;
    this.recentFailures[chain] = [];

    this.logger.warn("LEARN_UPDATE", {
      chain,
      eventType: "CIRCUIT_RESET",
    });
  }

  private async refreshFlashLoanPremiums() {
    if (!this.deps.fetchFlashLoanPremiumBps) return;

    for (const chain of ["arbitrum", "base"] as const) {
      try {
        const bps = await this.deps.fetchFlashLoanPremiumBps(chain);
        this.flashLoanPremiumBps[chain] = bps;

        this.logger.info("LEARN_UPDATE", {
          chain,
          eventType: "FLASH_LOAN_PREMIUM_REFRESH",
          bps,
        });
      } catch (error) {
        this.logger.warn("LEARN_UPDATE", {
          chain,
          eventType: "FLASH_LOAN_PREMIUM_REFRESH_FAIL",
          error: String(error),
        });
      }
    }
  }

  private async persistReplay(record: ReplayRecord) {
    if (!this.cfg.replayEnabled || !this.deps.persistReplay) return;
    await this.deps.persistReplay(record);
  }

  private now(): number {
    return this.deps.nowMs?.() ?? Date.now();
  }
}
