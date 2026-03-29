// execution-engine.js
// Starter execution engine for Arbitrum + Base arbitrage filtering/sizing/scoring
// Converted to CommonJS for native PM2 Node.js execution.

const ARBITRUM_CONFIG = {
    chainId: 42161,
    name: "arbitrum",
    minGrossProfitUsd: 40,
    minNetProfitUsd: 25,
    maxGasUsd: 3,
    maxPriceImpactBps: 25,
    maxSlippageBps: 20,
    maxBlockAge: 1,
    minPoolLiquidityUsd: 150000,
    min24hVolumeUsd: 300000,
    allowedTokens: ["WETH", "USDC", "USDT", "DAI", "WBTC", "ARB"],
    allowedDexes: ["univ3", "sushi", "camelot"],
    flashLoanMinNotionalUsd: 15000,
    flashLoanNetProfitMultiplier: 1.5,
    maxRouteHops: 2,
};

const BASE_CONFIG = {
    chainId: 8453,
    name: "base",
    minGrossProfitUsd: 35,
    minNetProfitUsd: 20,
    maxGasUsd: 2.5,
    maxPriceImpactBps: 25,
    maxSlippageBps: 20,
    maxBlockAge: 1,
    minPoolLiquidityUsd: 125000,
    min24hVolumeUsd: 250000,
    allowedTokens: ["WETH", "USDC", "DAI", "WBTC", "cbBTC", "USDbC"],
    allowedDexes: ["univ3", "sushi", "aerodrome"],
    flashLoanMinNotionalUsd: 12000,
    flashLoanNetProfitMultiplier: 1.5,
    maxRouteHops: 2,
};

class RouteMemory {
    constructor() {
        this.stats = new Map();
    }

    key(chain, tokenIn, tokenOut, dexBuy, dexSell) {
        return `${chain}:${tokenIn}:${tokenOut}:${dexBuy}:${dexSell}`;
    }

    get(chain, tokenIn, tokenOut, dexBuy, dexSell) {
        const k = this.key(chain, tokenIn, tokenOut, dexBuy, dexSell);
        return this.stats.get(k) ?? {
            attempts: 0,
            successes: 0,
            avgNetProfitUsd: 0,
            failReasons: {},
        };
    }

    record(chain, tokenIn, tokenOut, dexBuy, dexSell, ok, netProfitUsd, failureReason) {
        const k = this.key(chain, tokenIn, tokenOut, dexBuy, dexSell);
        const current = this.get(chain, tokenIn, tokenOut, dexBuy, dexSell);

        const nextAttempts = current.attempts + 1;
        const nextSuccesses = current.successes + (ok ? 1 : 0);
        const nextAvgNet = ((current.avgNetProfitUsd * current.attempts) + netProfitUsd) / nextAttempts;

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

    reliability(chain, tokenIn, tokenOut, dexBuy, dexSell) {
        const s = this.get(chain, tokenIn, tokenOut, dexBuy, dexSell);
        if (s.attempts < 5) return 0.5;
        return s.successes / s.attempts;
    }
}

function getChainConfig(chain) {
    return chain === "arbitrum" ? ARBITRUM_CONFIG : BASE_CONFIG;
}

function preFilter(opp, cfg) {
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

function defaultRiskReserves(amountInUsd) {
    return {
        slippageReserveUsd: Math.max(2, amountInUsd * 0.0008),
        mevReserveUsd: Math.max(1, amountInUsd * 0.0003),
    };
}

function calcNetProfitUsd(input) {
    return (
        input.grossProfitUsd -
        input.gasUsd -
        input.dexFeesUsd -
        input.flashLoanFeeUsd -
        input.slippageReserveUsd -
        input.mevReserveUsd
    );
}

function buildTestSizes(notionalUsdHint) {
    const base = Math.max(notionalUsdHint, 5000);
    return [
        base * 0.10,
        base * 0.20,
        base * 0.35,
        base * 0.50,
    ].map(v => Math.round(v)).filter(v => v >= 500);
}

function chooseExecutionMode(amountInUsd, netProfitUsd, cfg) {
    if (amountInUsd >= cfg.flashLoanMinNotionalUsd &&
        netProfitUsd >= cfg.minNetProfitUsd * cfg.flashLoanNetProfitMultiplier) {
        return "flash";
    }
    return "wallet";
}

function classifySimulationFailure(sim) {
    const text = `${sim.decodedReason ?? ""} ${String(sim.rawError ?? "")} ${sim.revertData ?? ""}`.toLowerCase();
    
    if (text.includes("insufficient_output_amount")) return "INSUFFICIENT_OUTPUT_AMOUNT";
    if (text.includes("transfer_failed") || text.includes("transfer failed")) return "TRANSFER_FAILED";
    if (text.includes("callback")) return "CALLBACK_FAILED";
    if (text.includes("asset not returned")) return "ASSET_NOT_RETURNED";
    if (text.includes("deadline")) return "DEADLINE_EXPIRED";
    if (text.includes("encoding")) return "ROUTE_ENCODING_INVALID";
    if (text.includes("state changed") || text.includes("liquidity changed") || text.includes("tick")) return "POOL_STATE_CHANGED";
    
    return sim.reason ?? "REVERTED_OR_IMPOSSIBLE";
}

function scoreOpportunity(input) {
    let score = 0;
    score += input.netProfitUsd * 4;
    score += Math.min(input.liquidityUsd / 100000, 10) * 3;
    score -= input.priceImpactBps * 1.5;
    score -= input.gasUsd * 2;
    score += input.reliability * 20;

    if (input.chain === "arbitrum" || input.chain === "base") {
        score += 5;
    }
    return Number(score.toFixed(2));
}

async function evaluateOpportunity(opp, deps, memory) {
    const cfg = getChainConfig(opp.chain);
    const pf = preFilter(opp, cfg);

    if (!pf.ok) {
        return { ok: false, opportunityId: opp.id, chain: opp.chain, reason: pf.reason };
    }

    const testSizes = buildTestSizes(opp.amountInUsdHint);
    let best = null;

    for (const amountInUsd of testSizes) {
        const quote = await deps.quoteExactRoute(opp, amountInUsd);

        if (!quote.ok || !quote.route || quote.grossProfitUsd == null || quote.gasUsd == null || quote.dexFeesUsd == null || quote.flashLoanFeeUsd == null) {
            if (deps.log) deps.log("[QUOTE_FAIL]", {
                opportunityId: opp.id, chain: opp.chain, amountInUsd, reason: quote.reason ?? "QUOTE_FAILED"
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
            if (deps.log) deps.log("[NET_FAIL]", {
                opportunityId: opp.id, chain: opp.chain, amountInUsd, grossProfitUsd: quote.grossProfitUsd, netProfitUsd, minNetProfitUsd: cfg.minNetProfitUsd
            });
            continue;
        }

        const mode = chooseExecutionMode(amountInUsd, netProfitUsd, cfg);

        const sim = await deps.simulateExactExecution({
            opp, amountInUsd, mode, route: quote.route, maxSlippageBps: cfg.maxSlippageBps,
        });

        if (!sim.ok) {
            const failReason = classifySimulationFailure(sim);
            if (deps.log) deps.log("[SIM_FAIL]", {
                opportunityId: opp.id, chain: opp.chain, amountInUsd, mode, failReason, decodedReason: sim.decodedReason, revertData: sim.revertData
            });

            memory.record(opp.chain, opp.tokenIn, opp.tokenOut, opp.dexBuy, opp.dexSell, false, 0, failReason);
            continue;
        }

        const reliability = memory.reliability(opp.chain, opp.tokenIn, opp.tokenOut, opp.dexBuy, opp.dexSell);
        const score = scoreOpportunity({
            netProfitUsd,
            liquidityUsd: opp.minObservedPoolLiquidityUsd,
            priceImpactBps: opp.estimatedPriceImpactBps,
            gasUsd: quote.gasUsd,
            reliability,
            chain: opp.chain,
        });

        const candidate = {
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
        return { ok: false, opportunityId: opp.id, chain: opp.chain, reason: "NO_VALID_SIZE" };
    }

    memory.record(opp.chain, opp.tokenIn, opp.tokenOut, opp.dexBuy, opp.dexSell, true, best.netProfitUsd ?? 0);
    return best;
}

function shouldExecute(result, minScore = 40) {
    return !!(result.ok && (result.score ?? 0) >= minScore && (result.netProfitUsd ?? 0) > 0);
}

async function processOpportunity(opp, deps, memory) {
    const result = await evaluateOpportunity(opp, deps, memory);
    if (deps.log) deps.log("[EVAL_RESULT]", result);

    if (!result.ok) {
        return result;
    }

    if (!shouldExecute(result, 40)) {
        return { ...result, ok: false, reason: "SCORE_TOO_LOW" };
    }

    return result;
}

async function quoteExactRouteStub(_opp, amountInUsd) {
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

async function simulateExactExecutionStub(input) {
    const fakeEdge = input.amountInUsd < 700 ? false : true;
    if (!fakeEdge) {
        return {
            ok: false,
            mode: input.mode,
            decodedReason: "INSUFFICIENT_OUTPUT_AMOUNT",
            reason: "INSUFFICIENT_OUTPUT_AMOUNT",
        };
    }
    return { ok: true, mode: input.mode };
}

module.exports = {
    ARBITRUM_CONFIG,
    BASE_CONFIG,
    RouteMemory,
    getChainConfig,
    preFilter,
    defaultRiskReserves,
    calcNetProfitUsd,
    buildTestSizes,
    chooseExecutionMode,
    classifySimulationFailure,
    scoreOpportunity,
    evaluateOpportunity,
    shouldExecute,
    processOpportunity,
    quoteExactRouteStub,
    simulateExactExecutionStub
};
