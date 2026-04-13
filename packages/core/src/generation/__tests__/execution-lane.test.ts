import { describe, it, expect } from "vitest";
import { selectExecutionLane } from "../execution-lane.js";
import { getQualityProfile } from "../../config/quality-profile.js";

describe("selectExecutionLane", () => {
  it("budget preset + simple page → fast lane", () => {
    const base = getQualityProfile("budget");
    const complexity = { score: 3, fileCount: 2, dirSpread: 1, crossLanguage: false };
    const result = selectExecutionLane({ preset: "budget", base, complexity, signals: {} });
    expect(result.lane).toBe("fast");
  });

  it("balanced preset + normal page → standard lane", () => {
    const base = getQualityProfile("balanced");
    const complexity = { score: 8, fileCount: 4, dirSpread: 2, crossLanguage: false };
    const result = selectExecutionLane({ preset: "balanced", base, complexity, signals: {} });
    expect(result.lane).toBe("standard");
  });

  it("balanced preset + runtime trouble signals → deep lane with boosted drafterMaxSteps", () => {
    const base = getQualityProfile("balanced");
    const complexity = { score: 8, fileCount: 4, dirSpread: 2, crossLanguage: false };
    const signals = { draftTruncated: true, factualRisksCount: 2, missingEvidenceCount: 1 };
    const result = selectExecutionLane({ preset: "balanced", base, complexity, signals });
    expect(result.lane).toBe("deep");
    // drafterMaxSteps should be boosted beyond the base-adjusted value
    const baseAdjusted = base.drafterMaxSteps; // score=8 → no complexity boost from adjustParams
    expect(result.params.drafterMaxSteps).toBeGreaterThan(baseAdjusted);
  });
});
