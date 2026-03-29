// logger.ts
// Structured logger + lightweight metrics hooks for arbitrage engine

import { FailureReason } from "./failure-classifier";

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogEvent =
  | "SCANNER_HEARTBEAT"
  | "OPPORTUNITY_DETECTED"
  | "PREFILTER_REJECT"
  | "QUOTE_OK"
  | "QUOTE_FAIL"
  | "NET_FAIL"
  | "SIM_OK"
  | "SIM_FAIL"
  | "EXECUTE_ATTEMPT"
  | "EXECUTE_SENT"
  | "EXECUTE_FAIL"
  | "EXECUTE_CONFIRMED"
  | "EXECUTE_REVERTED"
  | "LEARN_UPDATE"
  | "SYSTEM_STARTUP";

export type LogContext = {
  chain?: string;
  opportunityId?: string;
  tokenIn?: string;
  tokenOut?: string;
  dexBuy?: string;
  dexSell?: string;
  mode?: "wallet" | "flash";
  amountInUsd?: number;
  grossProfitUsd?: number;
  netProfitUsd?: number;
  gasUsd?: number;
  score?: number;
  blockSeen?: number;
  blockNow?: number;
  latencyMs?: number;
  failure?: FailureReason | string;
  txHash?: string;
  [key: string]: unknown;
};

export type LoggerOptions = {
  service: string;
  minLevel?: LogLevel;
  json?: boolean;
};

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export class EngineLogger {
  private service: string;
  private minLevel: LogLevel;
  private json: boolean;
  private counters = new Map<string, number>();

  constructor(opts: LoggerOptions) {
    this.service = opts.service;
    this.minLevel = opts.minLevel ?? "info";
    this.json = opts.json ?? true;
  }

  metricInc(name: string, by = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + by);
  }

  getMetricsSnapshot(): Record<string, number> {
    return Object.fromEntries(this.counters.entries());
  }

  debug(event: LogEvent, ctx: LogContext = {}): void {
    this.write("debug", event, ctx);
  }

  info(event: LogEvent, ctx: LogContext = {}): void {
    this.write("info", event, ctx);
  }

  warn(event: LogEvent, ctx: LogContext = {}): void {
    this.write("warn", event, ctx);
  }

  error(event: LogEvent, ctx: LogContext = {}): void {
    this.write("error", event, ctx);
  }

  private write(level: LogLevel, event: LogEvent, ctx: LogContext): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.minLevel]) return;

    const payload = {
      ts: new Date().toISOString(),
      level,
      service: this.service,
      event,
      ...ctx,
    };

    if (this.json) {
      const line = JSON.stringify(payload);
      if (level === "error") console.error(line);
      else if (level === "warn") console.warn(line);
      else console.log(line);
      return;
    }

    const line = `[${payload.ts}] [${level.toUpperCase()}] [${this.service}] ${event} ${JSON.stringify(ctx)}`;
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
  }
}

export function recordFailureMetrics(logger: EngineLogger, failure: FailureReason, chain?: string): void {
  logger.metricInc("failure.total");
  logger.metricInc(`failure.${failure}`);
  if (chain) logger.metricInc(`failure.${chain}.${failure}`);
}

export function recordSuccessMetrics(logger: EngineLogger, chain?: string, mode?: string): void {
  logger.metricInc("execution.success");
  if (chain) logger.metricInc(`execution.success.${chain}`);
  if (mode) logger.metricInc(`execution.success.${mode}`);
}

export function recordOpportunityMetrics(logger: EngineLogger, chain?: string): void {
  logger.metricInc("opportunity.detected");
  if (chain) logger.metricInc(`opportunity.detected.${chain}`);
}
