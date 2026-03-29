export { ArbOrchestrator } from "./engine-orchestrator";
export * from "./execution-engine";
export { classifyFailure, FailureReason } from "./failure-classifier";
export { EngineLogger, LogEvent, LogContext } from "./logger";
export { ORCHESTRATOR_CONFIG } from "./orchestrator-config";

// Shim for legacy js callers
export const evaluatePipeline = async (opp: any, simulatorCB: any, executionCB: any) => {
    // Legacy mapping will be replaced by the new ArbOrchestrator shortly.
    console.warn("[DECISION-ENGINE] Legacy evaluatePipeline called. Migration to new TS orchestrator is pending.");
    const sim = await simulatorCB(opp);
    if(sim && sim.passed) {
        await executionCB(opp, 1000, sim);
    }
};
