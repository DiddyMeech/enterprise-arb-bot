export { ArbOrchestrator } from "./engine-orchestrator";
export * from "./execution-engine";
export { classifyFailure, FailureReason } from "./failure-classifier";
export { EngineLogger, LogEvent, LogContext } from "./logger";
export { ORCHESTRATOR_CONFIG } from "./orchestrator-config";
export { CanonicalRoutePlan, BuiltExecutionPlan, computeRouteHash, buildExecutionPlan } from "./calldata-builder";
export { EXECUTOR_ABI, EXECUTOR_IFACE, encodeExecutorCall, ExecutorMode, getExecutorFunctionName, getSelector } from "./executor-abi";
export { getCodeInfo, extractSelector, safeErrorString, decodeCommonRevert, buildSimFailureReport } from "./sim-debug";
export { normalizeRoute, RawRouteLegInput, RawRouteInput } from "./route-normalizer";
export { encodeDexLeg, SupportedDex, NormalizedDexLeg, EncodedDexLeg } from "./dex-encoders";

// Shim for legacy js callers — errors are re-thrown so callers get real stack traces
export const evaluatePipeline = async (opp: any, simulatorCB: any, executionCB: any) => {
    console.warn("[DECISION-ENGINE] Legacy evaluatePipeline called. Migration to new TS orchestrator is pending.");
    let sim: any;
    try {
        sim = await simulatorCB(opp);
    } catch (err) {
        console.error("[DECISION-ENGINE] evaluatePipeline: simulatorCB threw:", err);
        throw err;
    }
    if (sim && sim.passed) {
        try {
            await executionCB(opp, 1000, sim);
        } catch (err) {
            console.error("[DECISION-ENGINE] evaluatePipeline: executionCB threw:", err);
            throw err;
        }
    }
};
