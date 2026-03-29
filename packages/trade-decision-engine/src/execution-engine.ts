// execution-engine.ts
// Starter execution engine for Arbitrum + Base arbitrage filtering/sizing/scoring
// This is framework-agnostic and meant to plug into your existing scanner/simulator/executor.
//
// Main goals:
// 1) reject fake spreads early
// 2) test multiple sizes
// 3) compute realistic net profit
// 4) classify simulation failures
// 5) choose wallet vs flash-loan mode
//
// Replace the stubbed functions at the bottom with your real integrations.

import { classifySimulationFailure, FailureReason } from "./failure-classifier";

export type ChainName = "arbitrum" | "base";
export type DexName = "univ3" | "sushi" | "camelot" | "aerodrome";
export type TokenSymbol =
  | "WETH"
  | "USDC"
  | "USDT"
  | "DAI"
  | "WBTC"
  | "ARB"
  | "cbBTC"
  | "USDbC";

export type ChainConfig = {
  chainId: number;
  name: ChainName;
  minGrossProfitUsd: number;
  minNetProfitUsd: number;
  maxGasUsd: number;
  maxPriceImpactBps: number;
  maxSlippageBps: number;
  maxBlockAge: number;
  minPoolLiquidityUsd: number;
  min24hVolumeUsd: number;
  allowedTokens: TokenSymbol[];
  allowedDexes: DexName[];
  flashLoanMinNotionalUsd: number;
  flashLoanNetProfitMultiplier: number;
  maxRouteHops: number;
};

export const ARBITRUM_CONFIG: ChainConfig = {
  chainId: 42161,
  name: "arbitrum",
  minGrossProfitUsd: 40,
  minNetProfitUsd: 25,
  maxGasUsd: 3,
  maxPriceImpactBps: 25,
  maxSlippageBps: 20,
  maxBlockAge: 1,
  minPoolLiquidityUsd: 150_000,
  min24hVolumeUsd: 300_000,
  allowedTokens: ["WETH", "USDC", "USDT", "DAI", "WBTC", "ARB"],
  allowedDexes: ["univ3", "sushi", "camelot"],
  flashLoanMinNotionalUsd: 15_000,
  flashLoanNetProfitMultiplier: 1.5,
  maxRouteHops: 2,
};

export const BASE_CONFIG: ChainConfig = {
  chainId: 8453,
  name: "base",
  minGrossProfitUsd: 35,
  minNetProfitUsd: 20,
  maxGasUsd: 2.5,
  maxPriceImpactBps: 25,
  maxSlippageBps: 20,
  maxBlockAge: 1,
  minPoolLiquidityUsd: 125_000,
  min24hVolumeUsd: 250_000,
  allowedTokens: ["WETH", "USDC", "DAI", "WBTC", "cbBTC", "USDbC"],
  allowedDexes: ["univ3", "sushi", "aerodrome"],
  flashLoanMinNotionalUsd: 12_000,
  flashLoanNetProfitMultiplier: 1.5,
  maxRouteHops: 2,
};

export type Opportunity = {
  id: string;
  chain: ChainName;
  tokenIn: TokenSymbol;
  tokenOut: TokenSymbol;
  dexBuy: DexName;
  dexSell: DexName;
  amountInUsdHint: number;
  quotedGrossProfitUsd: number;
  estimatedGasUsd: number;
  estimatedPriceImpactBps: number;
  minObservedPoolLiquidityUsd: number;
  minObserved24hVolumeUsd: number;
  routeHops: number;
  blockNumberSeen: number;
  currentBlockNumber: number;
  quoteTimestampMs: number;
};

export type RouteLeg = {
  dex: DexName;
  tokenIn: TokenSymbol;
  tokenOut: TokenSymbol;
  feeTier?: number;
  pool?: string;
};

export type RoutePlan = {
  chain: ChainName;
  legs: RouteLeg[];
  amountInUsd: number;
  expectedAmountOutRaw: string;
  expectedGrossProfitUsd: number;
};

export type QuoteResult = {
  ok: boolean;
  route?: RoutePlan;
  grossProfitUsd?: number;
  gasUsd?: number;
  dexFeesUsd?: number;
  flashLoanFeeUsd?: number;
  amountOutRaw?: string;
  reason?: string;
};

export type ExecutionMode = "wallet" | "flash";

export type SimulationResult = {
  ok: boolean;
  mode: ExecutionMode;
  revertData?: string;
  decodedReason?: string;
  rawError?: unknown;
  reason?: FailureReason;
};

export type EvaluationResult = {
  ok: boolean;
  opportunityId: string;
  chain: ChainName;
  mode?: ExecutionMode;
  reason?: string;
  score?: number;
  bestSizeUsd?: number;
  netProfitUsd?: number;
  route?: RoutePlan;
  diagnostics?: Record<string, unknown>;
};

export type RouteStats = {
  attempts: number;
  successes: number;
  avgNetProfitUsd: number;
  failReasons: Partial<Record<FailureReason, number>>;
};

export class RouteMemory {
  private stats = new Map<string, RouteStats>();

  private key(chain: ChainName, tokenIn: TokenSymbol, tokenOut: TokenSymbol, dexBuy: DexName, dexSell: DexName): string {
    return `${chain}:${tokenIn}:${tokenOut}:${dexBuy}:${dexSell}`;
  }

  get(chain: ChainName, tokenIn: TokenSymbol, tokenOut: TokenSymbol, dexBuy: DexName, dexSell: DexName): RouteStats {
    const k = this.key(chain, tokenIn, tokenOut, dexBuy, dexSell);
    return (
      this.stats.get(k) ?? {
        attempts: 0,
        successes: 0,
        avgNetProfitUsd: 0,
        failReasons: {},
      }
    );
  }

  record(
    chain: ChainName,
    tokenIn: TokenSymbol,
    tokenOut: TokenSymbol,
    dexBuy: DexName,
    dexSell: DexName,
    ok: boolean,
    netProfitUsd: number,
    failureReason?: FailureReason,
  ): void {
    const k = this.key(chain, tokenIn, tokenOut, dexBuy, dexSell);
    const current = this.get(chain, tokenIn, tokenOut, dexBuy, dexSell);

    const nextAttempts = current.attempts + 1;
    const nextSuccesses = current.successes + (ok ? 1 : 0);
    const nextAvgNet =
      ((current.avgNetProfitUsd * current.attempts) + netProfitUsd) / nextAttempts;

    const failReasons = { ...current.failReasons };
    if (!ok && failureReason) {
      failReasons[failureReason] = (failReasons[failureReason] ?? 0) + 1;
    }

    this.stats.set(k, {
      attempts: nextAttempts,
      successes: nextSuccesses,
      avgNetProfitUsd: nextAvgNet,
      failReasons,
    });
  }

  reliability(chain: ChainName, tokenIn: TokenSymbol, tokenOut: TokenSymbol, dexBuy: DexName, dexSell: DexName): number {
    const s = this.get(chain, tokenIn, tokenOut, dexBuy, dexSell);
    if (s.attempts < 5) return 0.5;
    return s.successes / s.attempts;
  }
}

export function getChainConfig(chain: ChainName): ChainConfig {
  return chain === "arbitrum" ? ARBITRUM_CONFIG : BASE_CONFIG;
}

export function preFilter(opp: Opportunity, cfg: ChainConfig): { ok: true } | { ok: false; reason: FailureReason } {
  if (!cfg.allowedTokens.includes(opp.tokenIn) || !cfg.allowedTokens.includes(opp.tokenOut)) {
    return { ok: false, reason: "TOKEN_NOT_ALLOWED" };
  }

  if (!cfg.allowedDexes.includes(opp.dexBuy) || !cfg.allowedDexes.includes(opp.dexSell)) {
    return { ok: false, reason: "DEX_NOT_ALLOWED" };
  }

  if (opp.routeHops > cfg.maxRouteHops) {
    return { ok: false, reason: "TOO_MANY_HOPS" };
  }

  if (opp.quotedGrossProfitUsd < cfg.minGrossProfitUsd) {
    return { ok: false, reason: "GROSS_PROFIT_TOO_LOW" };
  }

  if (opp.estimatedGasUsd > cfg.maxGasUsd) {
    return { ok: false, reason: "GAS_TOO_HIGH" };
  }

  if (opp.estimatedPriceImpactBps > cfg.maxPriceImpactBps) {
    return { ok: false, reason: "PRICE_IMPACT_TOO_HIGH" };
  }

  if (opp.minObservedPoolLiquidityUsd < cfg.minPoolLiquidityUsd) {
    return { ok: false, reason: "POOL_LIQUIDITY_TOO_LOW" };
  }

  if (opp.minObserved24hVolumeUsd < cfg.min24hVolumeUsd) {
    return { ok: false, reason: "POOL_VOLUME_TOO_LOW" };
  }

  if ((opp.currentBlockNumber - opp.blockNumberSeen) > cfg.maxBlockAge) {
    return { ok: false, reason: "STALE_OPPORTUNITY" };
  }

  return { ok: true };
}

export function defaultRiskReserves(amountInUsd: number): { slippageReserveUsd: number; mevReserveUsd: number } {
  return {
    slippageReserveUsd: Math.max(2, amountInUsd * 0.0008),
    mevReserveUsd: Math.max(1, amountInUsd * 0.0003),
  };
}

export function calcNetProfitUsd(input: {
  grossProfitUsd: number;
  gasUsd: number;
  dexFeesUsd: number;
  flashLoanFeeUsd: number;
  slippageReserveUsd: number;
  mevReserveUsd: number;
}): number {
  return (
    input.grossProfitUsd -
    input.gasUsd -
    input.dexFeesUsd -
    input.flashLoanFeeUsd -
    input.slippageReserveUsd -
    input.mevReserveUsd
  );
}

export function buildTestSizes(notionalUsdHint: number): number[] {
  const base = Math.max(notionalUsdHint, 5000);
  return [
    base * 0.10,
    base * 0.20,
    base * 0.35,
    base * 0.50,
  ]
    .map(v => Math.round(v))
    .filter(v => v >= 500);
}

export function chooseExecutionMode(amountInUsd: number, netProfitUsd: number, cfg: ChainConfig): ExecutionMode {
  if (
    amountInUsd >= cfg.flashLoanMinNotionalUsd &&
    netProfitUsd >= cfg.minNetProfitUsd * cfg.flashLoanNetProfitMultiplier
  ) {
    return "flash";
  }
  return "wallet";
}

export function scoreOpportunity(input: {
  netProfitUsd: number;
  liquidityUsd: number;
  priceImpactBps: number;
  gasUsd: number;
  reliability: number;
  chain: ChainName;
}): number {
  let score = 0;
  score += input.netProfitUsd * 4;
  score += Math.min(input.liquidityUsd / 100_000, 10) * 3;
  score -= input.priceImpactBps * 1.5;
  score -= input.gasUsd * 2;
  score += input.reliability * 20;

  if (input.chain === "arbitrum" || input.chain === "base") {
    score += 5;
  }

  return Number(score.toFixed(2));
}

export type EvaluateDeps = {
  quoteExactRoute: (opp: Opportunity, amountInUsd: number) => Promise<QuoteResult>;
  simulateExactExecution: (input: {
    opp: Opportunity;
    amountInUsd: number;
    mode: ExecutionMode;
    route: RoutePlan;
    maxSlippageBps: number;
  }) => Promise<SimulationResult>;
  nowMs?: () => number;
  log?: (msg: string, payload?: unknown) => void;
};

export async function evaluateOpportunity(
  opp: Opportunity,
  deps: EvaluateDeps,
  memory: RouteMemory,
): Promise<EvaluationResult> {
  const cfg = getChainConfig(opp.chain);
  const pf = preFilter(opp, cfg);

  if (!pf.ok) {
    return {
      ok: false,
      opportunityId: opp.id,
      chain: opp.chain,
      reason: pf.reason,
    };
  }

  const testSizes = buildTestSizes(opp.amountInUsdHint);
  let best: EvaluationResult | null = null;

  for (const amountInUsd of testSizes) {
    const quote = await deps.quoteExactRoute(opp, amountInUsd);

    if (!quote.ok || !quote.route || quote.grossProfitUsd == null || quote.gasUsd == null || quote.dexFeesUsd == null || quote.flashLoanFeeUsd == null) {
      deps.log?.("[QUOTE_FAIL]", {
        opportunityId: opp.id,
        chain: opp.chain,
        amountInUsd,
        reason: quote.reason ?? "QUOTE_FAILED",
      });
      continue;
    }

    const reserves = defaultRiskReserves(amountInUsd);
    const netProfitUsd = calcNetProfitUsd({
      grossProfitUsd: quote.grossProfitUsd,
      gasUsd: quote.gasUsd,
      dexFeesUsd: quote.dexFeesUsd,
      flashLoanFeeUsd: quote.flashLoanFeeUsd,
      slippageReserveUsd: reserves.slippageReserveUsd,
      mevReserveUsd: reserves.mevReserveUsd,
    });

    if (netProfitUsd < cfg.minNetProfitUsd) {
      deps.log?.("[NET_FAIL]", {
        opportunityId: opp.id,
        chain: opp.chain,
        amountInUsd,
        grossProfitUsd: quote.grossProfitUsd,
        netProfitUsd,
        minNetProfitUsd: cfg.minNetProfitUsd,
      });
      continue;
    }

    const mode = chooseExecutionMode(amountInUsd, netProfitUsd, cfg);

    const sim = await deps.simulateExactExecution({
      opp,
      amountInUsd,
      mode,
      route: quote.route,
      maxSlippageBps: cfg.maxSlippageBps,
    });

    if (!sim.ok) {
      const failReason = sim.reason ?? classifySimulationFailure({
        decodedReason: sim.decodedReason,
        revertData: sim.revertData,
        rawError: sim.rawError
      }).failure;

      deps.log?.("[SIM_FAIL]", {
        opportunityId: opp.id,
        chain: opp.chain,
        amountInUsd,
        mode,
        failReason,
        decodedReason: sim.decodedReason,
        revertData: sim.revertData,
      });

      memory.record(
        opp.chain,
        opp.tokenIn,
        opp.tokenOut,
        opp.dexBuy,
        opp.dexSell,
        false,
        0,
        failReason,
      );

      continue;
    }

    const reliability = memory.reliability(
      opp.chain,
      opp.tokenIn,
      opp.tokenOut,
      opp.dexBuy,
      opp.dexSell,
    );

    const score = scoreOpportunity({
      netProfitUsd,
      liquidityUsd: opp.minObservedPoolLiquidityUsd,
      priceImpactBps: opp.estimatedPriceImpactBps,
      gasUsd: quote.gasUsd,
      reliability,
      chain: opp.chain,
    });

    const candidate: EvaluationResult = {
      ok: true,
      opportunityId: opp.id,
      chain: opp.chain,
      mode,
      bestSizeUsd: amountInUsd,
      netProfitUsd,
      route: quote.route,
      score,
      diagnostics: {
        grossProfitUsd: quote.grossProfitUsd,
        gasUsd: quote.gasUsd,
        dexFeesUsd: quote.dexFeesUsd,
        flashLoanFeeUsd: quote.flashLoanFeeUsd,
        slippageReserveUsd: reserves.slippageReserveUsd,
        mevReserveUsd: reserves.mevReserveUsd,
        reliability,
      },
    };

    if (!best || (candidate.netProfitUsd ?? 0) > (best.netProfitUsd ?? 0)) {
      best = candidate;
    }
  }

  if (!best) {
    return {
      ok: false,
      opportunityId: opp.id,
      chain: opp.chain,
      reason: "NO_VALID_SIZE",
    };
  }

  memory.record(
    opp.chain,
    opp.tokenIn,
    opp.tokenOut,
    opp.dexBuy,
    opp.dexSell,
    true,
    best.netProfitUsd ?? 0,
  );

  return best;
}

export function shouldExecute(result: EvaluationResult, minScore = 40): boolean {
  return !!(result.ok && (result.score ?? 0) >= minScore && (result.netProfitUsd ?? 0) > 0);
}

/**
 * ---- Example controller ----
 * Feed scanner opportunities here.
 */
export async function processOpportunity(
  opp: Opportunity,
  deps: EvaluateDeps,
  memory: RouteMemory,
): Promise<EvaluationResult> {
  const result = await evaluateOpportunity(opp, deps, memory);

  deps.log?.("[EVAL_RESULT]", result);

  if (!result.ok) {
    return result;
  }

  if (!shouldExecute(result, 40)) {
    return {
      ...result,
      ok: false,
      reason: "SCORE_TOO_LOW",
    };
  }

  return result;
}

export async function quoteExactRouteStub(_opp: Opportunity, amountInUsd: number): Promise<QuoteResult> {
  return {
    ok: true,
    route: {
      chain: _opp.chain,
      legs: [
        { dex: _opp.dexBuy, tokenIn: _opp.tokenIn, tokenOut: _opp.tokenOut, feeTier: 500 },
        { dex: _opp.dexSell, tokenIn: _opp.tokenOut, tokenOut: _opp.tokenIn, feeTier: 500 },
      ],
      amountInUsd,
      expectedAmountOutRaw: "0",
      expectedGrossProfitUsd: Math.max(45, amountInUsd * 0.003),
    },
    grossProfitUsd: Math.max(45, amountInUsd * 0.003),
    gasUsd: _opp.chain === "arbitrum" ? 1.8 : 1.2,
    dexFeesUsd: amountInUsd * 0.0015,
    flashLoanFeeUsd: amountInUsd >= 12000 ? amountInUsd * 0.0005 : 0,
    amountOutRaw: "0",
  };
}

export async function simulateExactExecutionStub(input: {
  opp: Opportunity;
  amountInUsd: number;
  mode: ExecutionMode;
  route: RoutePlan;
  maxSlippageBps: number;
}): Promise<SimulationResult> {
  const fakeEdge = input.amountInUsd < 700 ? false : true;
  if (!fakeEdge) {
    return {
      ok: false,
      mode: input.mode,
      decodedReason: "INSUFFICIENT_OUTPUT_AMOUNT",
      reason: "INSUFFICIENT_OUTPUT_AMOUNT",
    };
  }

  return {
    ok: true,
    mode: input.mode,
  };
}
