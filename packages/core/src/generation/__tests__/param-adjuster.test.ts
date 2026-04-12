import { describe, it, expect } from "vitest";
import { adjustParams } from "../param-adjuster.js";
import { getQualityProfile } from "../../config/quality-profile.js";

describe("adjustParams", () => {
  const base = getQualityProfile("quality");

  it("does not reduce any parameter below preset baseline", () => {
    const result = adjustParams(base, { score: 1, fileCount: 1, dirSpread: 1, crossLanguage: false });
    expect(result.forkWorkers).toBeGreaterThanOrEqual(base.forkWorkers);
    expect(result.drafterMaxSteps).toBeGreaterThanOrEqual(base.drafterMaxSteps);
  });

  it("increases parameters for high complexity", () => {
    const result = adjustParams(base, { score: 20, fileCount: 10, dirSpread: 6, crossLanguage: true });
    expect(result.forkWorkers).toBeGreaterThan(base.forkWorkers);
    expect(result.drafterMaxSteps).toBeGreaterThan(base.drafterMaxSteps);
  });

  it("increases reviewer verify for low citation density signal", () => {
    const result = adjustParams(base, { score: 5, fileCount: 3, dirSpread: 2, crossLanguage: false }, {
      lowCitationDensity: true,
    });
    expect(result.reviewerVerifyMinCitations).toBeGreaterThan(base.reviewerVerifyMinCitations);
  });

  it("boosts maxOutputTokens on truncation signal", () => {
    const result = adjustParams(base, { score: 5, fileCount: 3, dirSpread: 2, crossLanguage: false }, {
      draftTruncated: true,
    });
    expect(result.maxOutputTokensBoost).toBe(4096);
  });

  it("boosts forkWorkers on factual risks", () => {
    const result = adjustParams(base, { score: 5, fileCount: 3, dirSpread: 2, crossLanguage: false }, {
      factualRisksCount: 2,
    });
    expect(result.forkWorkers).toBeGreaterThan(base.forkWorkers);
  });

  it("no boost when no signals", () => {
    const result = adjustParams(base, { score: 3, fileCount: 1, dirSpread: 1, crossLanguage: false });
    expect(result.maxOutputTokensBoost).toBe(0);
    expect(result.forkWorkers).toBe(base.forkWorkers);
  });
});
