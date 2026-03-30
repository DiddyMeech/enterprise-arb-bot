/**
 * shadow-route-report.ts
 *
 * Formats the shadow route ranking as a fixed-width terminal table.
 * Accepts any logger with an .info(msg: string) method.
 */

import type { RankedRouteStats } from "./shadow-route-stats";

function pad(v: string, n: number): string {
  return v.length >= n ? v.slice(0, n) : v + " ".repeat(n - v.length);
}

const COLS = [
  { label: "Route",      width: 32 },
  { label: "Seen",       width: 6  },
  { label: "PF%",        width: 7  },
  { label: "Sim%",       width: 7  },
  { label: "WouldEx%",   width: 9  },
  { label: "AvgDiv",     width: 8  },
  { label: "AvgGross",   width: 10 },
  { label: "AvgNet",     width: 10 },
  { label: "AvgGas",     width: 8  },
  { label: "Score",      width: 8  },
];

function header(): string {
  return COLS.map((c) => pad(c.label, c.width)).join(" | ");
}

function separator(): string {
  return COLS.map((c) => "-".repeat(c.width)).join("-|-");
}

function row(r: RankedRouteStats): string {
  return [
    pad(r.routeFamily,                       COLS[0].width),
    pad(String(r.seen),                      COLS[1].width),
    pad(pct(r.prefilterPassRate),            COLS[2].width),
    pad(pct(r.simPassRate),                  COLS[3].width),
    pad(pct(r.wouldExecRate),                COLS[4].width),
    pad(r.avgDivergenceBps.toFixed(1),       COLS[5].width),
    pad(usd(r.avgGrossProfitUsd),            COLS[6].width),
    pad(usd(r.avgNetProfitUsd),              COLS[7].width),
    pad(usd(r.avgGasUsd),                    COLS[8].width),
    pad(r.rankScore.toFixed(2),              COLS[9].width),
  ].join(" | ");
}

function pct(v: number): string {
  return (v * 100).toFixed(1) + "%";
}

function usd(v: number): string {
  // Keep sign for negative net
  return (v >= 0 ? "" : "") + v.toFixed(4);
}

/**
 * Print a ranked route-family scoreboard via any logger.info.
 *
 * @param logger  - any object with { info(msg: string): void }
 * @param ranked  - output of ShadowRouteTracker.ranked()
 * @param topN    - how many rows to print (default: all)
 */
export function printShadowRouteRanking(
  logger: { info: (msg: string) => void },
  ranked: RankedRouteStats[],
  topN?: number,
): void {
  const rows = topN !== undefined ? ranked.slice(0, topN) : ranked;

  logger.info("── Shadow Route Ranking ──────────────────────────────────────────────────────────────────────────────────────────────────");
  logger.info(header());
  logger.info(separator());

  if (rows.length === 0) {
    logger.info("(no data yet)");
  } else {
    for (const r of rows) {
      logger.info(row(r));
    }
  }
}
