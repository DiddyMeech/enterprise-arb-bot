/**
 * shadow-route-stats.ts
 *
 * In-memory tracker for per-route-family shadow performance.
 *
 * Lifecycle events to record at each pipeline stage:
 *   seenRoute()      — on every incoming opportunity (before prefilter)
 *   prefilterPass()  — after prefilterOpportunity() returns ok:true
 *   prefilterReject()— after prefilterOpportunity() returns ok:false
 *   simPass()        — after processOpportunity() returns ok:true
 *   simFail()        — after processOpportunity() returns ok:false
 *   wouldExecute()   — in shadow mode when score clears minScoreToSend
 *
 * Call ranked() periodically to get sorted scoreboard rows.
 */

export type RouteFamilyKey =
  | "sushi->univ3:USDC/WETH"
  | "univ3->sushi:USDC/WETH"
  | "camelot->univ3:USDC/WETH"
  | "univ3->camelot:USDC/WETH"
  | "sushi->camelot:USDC/WETH"
  | "camelot->sushi:USDC/WETH"
  | "sushi->univ3:WETH/USDC"
  | "univ3->sushi:WETH/USDC"
  | "camelot->univ3:WETH/USDC"
  | "univ3->camelot:WETH/USDC"
  | "sushi->camelot:WETH/USDC"
  | "camelot->sushi:WETH/USDC"
  | string; // allow unknown families without compile errors

export type ShadowRouteStats = {
  routeFamily: RouteFamilyKey;

  seen:            number;
  prefilterPass:   number;
  prefilterReject: number;
  simPass:         number;
  simFail:         number;
  wouldExecute:    number;

  sumDivergenceBps:   number;
  sumGrossProfitUsd:  number;
  sumNetProfitUsd:    number;
  sumGasUsd:          number;

  lastSeenAt?:          number;
  lastWouldExecuteAt?:  number;
  lastRejectReason?:    string;
};

export type RankedRouteStats = ShadowRouteStats & {
  avgDivergenceBps:  number;
  avgGrossProfitUsd: number;
  avgNetProfitUsd:   number;
  avgGasUsd:         number;
  prefilterPassRate: number;
  simPassRate:       number;
  wouldExecRate:     number;
  rankScore:         number;
};

export type ShadowStatsSnapshot = {
  generatedAt: number;
  routes: ShadowRouteStats[];
};

function makeEmpty(routeFamily: string): ShadowRouteStats {
  return {
    routeFamily,
    seen: 0, prefilterPass: 0, prefilterReject: 0,
    simPass: 0, simFail: 0, wouldExecute: 0,
    sumDivergenceBps: 0, sumGrossProfitUsd: 0, sumNetProfitUsd: 0, sumGasUsd: 0,
  };
}

export class ShadowRouteTracker {
  private readonly stats = new Map<string, ShadowRouteStats>();

  private getOrCreate(routeFamily: string): ShadowRouteStats {
    let item = this.stats.get(routeFamily);
    if (!item) {
      item = makeEmpty(routeFamily);
      this.stats.set(routeFamily, item);
    }
    return item;
  }

  /** Call on every incoming opportunity, before the prefilter. */
  seenRoute(input: {
    routeFamily: string;
    divergenceBps?:  number;
    grossProfitUsd?: number;
    netProfitUsd?:   number;
    gasUsd?:         number;
    nowMs?:          number;
  }) {
    const s = this.getOrCreate(input.routeFamily);
    s.seen += 1;
    s.sumDivergenceBps   += input.divergenceBps  ?? 0;
    s.sumGrossProfitUsd  += input.grossProfitUsd ?? 0;
    s.sumNetProfitUsd    += input.netProfitUsd   ?? 0;
    s.sumGasUsd          += input.gasUsd         ?? 0;
    s.lastSeenAt          = input.nowMs ?? Date.now();
  }

  prefilterPass(routeFamily: string) {
    this.getOrCreate(routeFamily).prefilterPass += 1;
  }

  prefilterReject(routeFamily: string, reason?: string) {
    const s = this.getOrCreate(routeFamily);
    s.prefilterReject += 1;
    if (reason) s.lastRejectReason = reason;
  }

  simPass(routeFamily: string) {
    this.getOrCreate(routeFamily).simPass += 1;
  }

  simFail(routeFamily: string, reason?: string) {
    const s = this.getOrCreate(routeFamily);
    s.simFail += 1;
    if (reason) s.lastRejectReason = reason;
  }

  /** Call in shadow mode when evaluation.score clears minScoreToSend. */
  wouldExecute(routeFamily: string, nowMs?: number) {
    const s = this.getOrCreate(routeFamily);
    s.wouldExecute += 1;
    s.lastWouldExecuteAt = nowMs ?? Date.now();
  }

  /** Raw snapshot of all tracked families. */
  snapshot(): ShadowStatsSnapshot {
    return {
      generatedAt: Date.now(),
      routes: Array.from(this.stats.values()),
    };
  }

  /**
   * Returns route families sorted by composite rank score.
   *
   * Score weights (higher = better signal):
   *   prefilterPassRate × 30  — quality of raw opportunity signal
   *   simPassRate       × 40  — route is structurally executable
   *   wouldExecRate     × 50  — would have traded (strongest signal)
   *   avgDivergenceBps  × 0.05
   *   avgGrossProfitUsd × 5
   *   avgNetProfitUsd   × 8   — direct profitability
   *   avgGasUsd         × –3  — penalise gas-heavy routes
   */
  ranked(): RankedRouteStats[] {
    return Array.from(this.stats.values())
      .map((r): RankedRouteStats => {
        const n   = r.seen || 1; // avoid div-by-zero
        const pf  = r.prefilterPass || 1;

        const avgDiv   = r.sumDivergenceBps  / n;
        const avgGross = r.sumGrossProfitUsd / n;
        const avgNet   = r.sumNetProfitUsd   / n;
        const avgGas   = r.sumGasUsd         / n;

        const prefilterPassRate = r.prefilterPass / n;
        const simPassRate       = r.simPass / pf;
        const wouldExecRate     = r.wouldExecute / n;

        const rankScore =
          prefilterPassRate * 30 +
          simPassRate       * 40 +
          wouldExecRate     * 50 +
          avgDiv            * 0.05 +
          avgGross          * 5 +
          avgNet            * 8 -
          avgGas            * 3;

        return {
          ...r,
          avgDivergenceBps:  Number(avgDiv.toFixed(4)),
          avgGrossProfitUsd: Number(avgGross.toFixed(6)),
          avgNetProfitUsd:   Number(avgNet.toFixed(6)),
          avgGasUsd:         Number(avgGas.toFixed(6)),
          prefilterPassRate: Number(prefilterPassRate.toFixed(4)),
          simPassRate:       Number(simPassRate.toFixed(4)),
          wouldExecRate:     Number(wouldExecRate.toFixed(4)),
          rankScore:         Number(rankScore.toFixed(4)),
        };
      })
      .sort((a, b) => b.rankScore - a.rankScore);
  }
}
