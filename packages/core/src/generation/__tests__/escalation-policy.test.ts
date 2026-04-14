import { describe, it, expect } from "vitest";
import { buildLanePolicy, escalatePolicy, type LaneExecutionPolicy } from "../escalation-policy.js";
import { adjustParams, type AdjustedParams } from "../param-adjuster.js";
import { getQualityProfile } from "../../config/quality-profile.js";

/** Helper: build adjusted params for a given preset + complexity score. */
function makeAdjusted(
  preset: "quality" | "balanced" | "budget" | "local-only",
  score: number,
  signals: Parameters<typeof adjustParams>[2] = {},
): AdjustedParams {
  const base = getQualityProfile(preset);
  const complexity = { score, fileCount: Math.ceil(score / 2), dirSpread: 1, crossLanguage: false };
  return adjustParams(base, complexity, signals);
}

describe("buildLanePolicy", () => {
  it("carries through all adjusted params correctly", () => {
    const params = makeAdjusted("balanced", 8);
    const policy = buildLanePolicy("standard", params);

    expect(policy.lane).toBe("standard");
    expect(policy.forkWorkers).toBe(params.forkWorkers);
    expect(policy.forkWorkerConcurrency).toBe(params.forkWorkerConcurrency);
    expect(policy.drafterMaxSteps).toBe(params.drafterMaxSteps);
    expect(policy.maxRevisionAttempts).toBe(params.maxRevisionAttempts);
    expect(policy.maxOutputTokensBoost).toBe(params.maxOutputTokensBoost);
    expect(policy.reviewerMaxSteps).toBe(params.reviewerMaxSteps);
    expect(policy.reviewerVerifyMinCitations).toBe(params.reviewerVerifyMinCitations);
    expect(policy.reviewerStrictness).toBe(params.reviewerStrictness);
    expect(policy.workerMaxSteps).toBe(params.workerMaxSteps);
  });

  it("fast policy has lower forkWorkers/maxRevisionAttempts than standard", () => {
    const fastParams = makeAdjusted("budget", 2);
    const stdParams = makeAdjusted("balanced", 8);
    const fastPolicy = buildLanePolicy("fast", fastParams);
    const stdPolicy = buildLanePolicy("standard", stdParams);

    expect(fastPolicy.forkWorkers).toBeLessThanOrEqual(stdPolicy.forkWorkers);
    expect(fastPolicy.maxRevisionAttempts).toBeLessThanOrEqual(stdPolicy.maxRevisionAttempts);
  });

  it("deep policy has higher values than standard", () => {
    const stdParams = makeAdjusted("balanced", 8);
    const deepParams = makeAdjusted("balanced", 18, { draftTruncated: true });
    const stdPolicy = buildLanePolicy("standard", stdParams);
    const deepPolicy = buildLanePolicy("deep", deepParams);

    expect(deepPolicy.forkWorkers).toBeGreaterThan(stdPolicy.forkWorkers);
    expect(deepPolicy.drafterMaxSteps).toBeGreaterThan(stdPolicy.drafterMaxSteps);
  });
});

describe("escalatePolicy", () => {
  it("escalates from standard to deep — increases params", () => {
    const stdParams = makeAdjusted("balanced", 8);
    const stdPolicy = buildLanePolicy("standard", stdParams);

    const deepParams = makeAdjusted("balanced", 18, { draftTruncated: true });
    const escalated = escalatePolicy(stdPolicy, "deep", deepParams);

    expect(escalated.lane).toBe("deep");
    expect(escalated.forkWorkers).toBeGreaterThanOrEqual(stdPolicy.forkWorkers);
    expect(escalated.drafterMaxSteps).toBeGreaterThanOrEqual(stdPolicy.drafterMaxSteps);
  });

  it("never downgrades — deep stays deep even when newLane is standard", () => {
    const deepParams = makeAdjusted("balanced", 18, { draftTruncated: true });
    const deepPolicy = buildLanePolicy("deep", deepParams);

    const stdParams = makeAdjusted("balanced", 8);
    const result = escalatePolicy(deepPolicy, "standard", stdParams);

    expect(result.lane).toBe("deep");
    // Numeric params should be at least what the deep policy had
    expect(result.forkWorkers).toBeGreaterThanOrEqual(deepPolicy.forkWorkers);
    expect(result.drafterMaxSteps).toBeGreaterThanOrEqual(deepPolicy.drafterMaxSteps);
    expect(result.maxRevisionAttempts).toBeGreaterThanOrEqual(deepPolicy.maxRevisionAttempts);
  });

  it("never downgrades — deep stays deep even when newLane is fast", () => {
    const deepParams = makeAdjusted("quality", 20, { draftTruncated: true, factualRisksCount: 3 });
    const deepPolicy = buildLanePolicy("deep", deepParams);

    const fastParams = makeAdjusted("budget", 2);
    const result = escalatePolicy(deepPolicy, "fast", fastParams);

    expect(result.lane).toBe("deep");
  });

  it("returns a new object — never mutates the input", () => {
    const params = makeAdjusted("balanced", 8);
    const original = buildLanePolicy("standard", params);
    const originalCopy: LaneExecutionPolicy = { ...original };

    const deepParams = makeAdjusted("balanced", 18);
    escalatePolicy(original, "deep", deepParams);

    // Original must be unchanged
    expect(original).toEqual(originalCopy);
  });
});
