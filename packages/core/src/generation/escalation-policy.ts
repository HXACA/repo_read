import type { ExecutionLane } from "./throughput-metrics.js";
import type { AdjustedParams } from "./param-adjuster.js";

/**
 * A fully resolved execution policy that binds a lane to concrete cost
 * parameters. This is the single source of truth for "what does this lane
 * cost" — no scattered `if lane === ...` checks elsewhere in the pipeline.
 */
export type LaneExecutionPolicy = {
  lane: ExecutionLane;
  forkWorkers: number;
  forkWorkerConcurrency: number;
  drafterMaxSteps: number;
  maxRevisionAttempts: number;
  maxOutputTokensBoost: number;
  reviewerMaxSteps: number;
  reviewerVerifyMinCitations: number;
  reviewerStrictness: "lenient" | "normal" | "strict";
  workerMaxSteps: number;
};

/**
 * Build a complete execution policy from lane selection + quality profile.
 * This is the single source of truth for "what does this lane cost".
 */
export function buildLanePolicy(
  lane: ExecutionLane,
  adjustedParams: AdjustedParams,
): LaneExecutionPolicy {
  return {
    lane,
    forkWorkers: adjustedParams.forkWorkers,
    forkWorkerConcurrency: adjustedParams.forkWorkerConcurrency,
    drafterMaxSteps: adjustedParams.drafterMaxSteps,
    maxRevisionAttempts: adjustedParams.maxRevisionAttempts,
    maxOutputTokensBoost: adjustedParams.maxOutputTokensBoost,
    reviewerMaxSteps: adjustedParams.reviewerMaxSteps,
    reviewerVerifyMinCitations: adjustedParams.reviewerVerifyMinCitations,
    reviewerStrictness: adjustedParams.reviewerStrictness,
    workerMaxSteps: adjustedParams.workerMaxSteps,
  };
}

/** Lane ordering for escalation comparisons. */
const LANE_ORDER: Record<ExecutionLane, number> = {
  fast: 0,
  standard: 1,
  deep: 2,
};

/**
 * Escalate an existing policy when runtime signals change.
 * Returns a new policy (never mutates the input).
 *
 * If `newLane` would be a downgrade (e.g. standard when current is deep),
 * the current lane is preserved — escalation is monotonic within a page.
 */
export function escalatePolicy(
  current: LaneExecutionPolicy,
  newLane: ExecutionLane,
  adjustedParams: AdjustedParams,
): LaneExecutionPolicy {
  // Never downgrade: pick the higher lane
  const effectiveLane =
    LANE_ORDER[newLane] >= LANE_ORDER[current.lane] ? newLane : current.lane;

  const candidate = buildLanePolicy(effectiveLane, adjustedParams);

  // When we keep the current lane (downgrade blocked), also keep the
  // higher of each numeric parameter so boosts are never lost.
  if (effectiveLane === current.lane && newLane !== current.lane) {
    return {
      ...candidate,
      lane: current.lane,
      forkWorkers: Math.max(current.forkWorkers, candidate.forkWorkers),
      forkWorkerConcurrency: Math.max(current.forkWorkerConcurrency, candidate.forkWorkerConcurrency),
      drafterMaxSteps: Math.max(current.drafterMaxSteps, candidate.drafterMaxSteps),
      maxRevisionAttempts: Math.max(current.maxRevisionAttempts, candidate.maxRevisionAttempts),
      maxOutputTokensBoost: Math.max(current.maxOutputTokensBoost, candidate.maxOutputTokensBoost),
      reviewerMaxSteps: Math.max(current.reviewerMaxSteps, candidate.reviewerMaxSteps),
      reviewerVerifyMinCitations: Math.max(current.reviewerVerifyMinCitations, candidate.reviewerVerifyMinCitations),
      workerMaxSteps: Math.max(current.workerMaxSteps, candidate.workerMaxSteps),
    };
  }

  return candidate;
}
