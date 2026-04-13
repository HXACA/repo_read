import type { Preset } from "../types/config.js";
import type { QualityProfile } from "../config/quality-profile.js";
import type { PageComplexityScore } from "./complexity-scorer.js";
import { adjustParams, type RuntimeSignals, type AdjustedParams } from "./param-adjuster.js";
import type { ExecutionLane } from "./throughput-metrics.js";

export type ExecutionLanePlan = {
  lane: ExecutionLane;
  params: AdjustedParams;
};

export function selectExecutionLane(input: {
  preset: Preset;
  base: QualityProfile;
  complexity: PageComplexityScore;
  signals: RuntimeSignals;
}): ExecutionLanePlan {
  const { preset, base, complexity, signals } = input;

  // Step 1: get baseline adjusted params
  const params = adjustParams(base, complexity, signals);

  // Step 2: check hard signals or high complexity → deep lane with boosted params
  const hasHardSignals =
    signals.draftTruncated === true ||
    (signals.factualRisksCount ?? 0) > 0 ||
    (signals.missingEvidenceCount ?? 0) > 0;

  if (hasHardSignals || complexity.score >= 16) {
    const boostedParams: AdjustedParams = {
      ...params,
      forkWorkers: params.forkWorkers + 1,
      drafterMaxSteps: params.drafterMaxSteps + 10,
      maxRevisionAttempts: params.maxRevisionAttempts + 1,
    };
    return { lane: "deep", params: boostedParams };
  }

  // Step 3: fast lane for non-quality preset with simple pages
  if (preset !== "quality" && complexity.score <= 4) {
    const cappedParams: AdjustedParams = {
      ...params,
      forkWorkers: Math.min(params.forkWorkers, 1),
      maxRevisionAttempts: Math.min(params.maxRevisionAttempts, 1),
    };
    return { lane: "fast", params: cappedParams };
  }

  // Step 4: standard lane
  return { lane: "standard", params };
}
