import { describe, expect, it } from "vitest";
import { QUALITY_PROFILES, getQualityProfile } from "../quality-profile.js";
import type { Preset } from "../../types/config.js";

describe("quality profile", () => {
  it("defines a profile for every preset", () => {
    const presets: Preset[] = ["quality", "balanced", "budget", "local-only"];
    for (const p of presets) {
      expect(QUALITY_PROFILES[p]).toBeDefined();
    }
  });

  it("quality preset maximizes rigor", () => {
    const q = getQualityProfile("quality");
    expect(q.forkWorkers).toBe(3);
    expect(q.forkWorkerConcurrency).toBe(3);
    expect(q.maxRevisionAttempts).toBe(3);
    expect(q.reviewerVerifyMinCitations).toBe(3);
    expect(q.reviewerStrictness).toBe("strict");
    expect(q.askMaxSteps).toBeGreaterThan(0);
    expect(q.researchMaxSteps).toBeGreaterThan(0);
  });

  it("budget preset minimizes LLM calls", () => {
    const b = getQualityProfile("budget");
    expect(b.forkWorkers).toBe(1);
    expect(b.maxRevisionAttempts).toBe(1);
    expect(b.reviewerVerifyMinCitations).toBe(0);
    expect(b.reviewerStrictness).toBe("lenient");
    // Budget must never exceed quality on any cost dimension
    const q = getQualityProfile("quality");
    expect(b.forkWorkers).toBeLessThanOrEqual(q.forkWorkers);
    expect(b.maxRevisionAttempts).toBeLessThanOrEqual(q.maxRevisionAttempts);
    expect(b.drafterMaxSteps).toBeLessThanOrEqual(q.drafterMaxSteps);
    expect(b.askMaxSteps).toBeLessThanOrEqual(q.askMaxSteps);
    expect(b.researchMaxSteps).toBeLessThanOrEqual(q.researchMaxSteps);
  });

  it("balanced sits between quality and budget on key dimensions", () => {
    const q = getQualityProfile("quality");
    const m = getQualityProfile("balanced");
    const b = getQualityProfile("budget");

    expect(m.forkWorkers).toBeLessThanOrEqual(q.forkWorkers);
    expect(m.forkWorkers).toBeGreaterThanOrEqual(b.forkWorkers);

    expect(m.maxRevisionAttempts).toBeLessThanOrEqual(q.maxRevisionAttempts);
    expect(m.maxRevisionAttempts).toBeGreaterThanOrEqual(b.maxRevisionAttempts);

    expect(m.drafterMaxSteps).toBeLessThanOrEqual(q.drafterMaxSteps);
    expect(m.drafterMaxSteps).toBeGreaterThanOrEqual(b.drafterMaxSteps);
  });

  it("local-only mirrors budget aggressiveness", () => {
    const l = getQualityProfile("local-only");
    const b = getQualityProfile("budget");
    expect(l.forkWorkers).toBe(b.forkWorkers);
    expect(l.maxRevisionAttempts).toBe(b.maxRevisionAttempts);
    expect(l.drafterMaxSteps).toBe(b.drafterMaxSteps);
  });

  it("getQualityProfile returns the same reference each call (frozen)", () => {
    const a = getQualityProfile("quality");
    const b = getQualityProfile("quality");
    expect(a).toBe(b);
  });

  it("every preset defines pageConcurrency >= 1", () => {
    for (const preset of ["quality", "balanced", "budget", "local-only"] as const) {
      const p = getQualityProfile(preset);
      expect(p.pageConcurrency).toBeGreaterThanOrEqual(1);
    }
  });

  it("quality preset has pageConcurrency=3 (default target)", () => {
    expect(getQualityProfile("quality").pageConcurrency).toBe(3);
  });

  it("budget preset has pageConcurrency=1 (serial)", () => {
    expect(getQualityProfile("budget").pageConcurrency).toBe(1);
  });

  it("every preset defines deepLaneRevisionBonus in [0, 2]", () => {
    for (const preset of ["quality", "balanced", "budget", "local-only"] as const) {
      const p = getQualityProfile(preset);
      expect(p.deepLaneRevisionBonus).toBeGreaterThanOrEqual(0);
      expect(p.deepLaneRevisionBonus).toBeLessThanOrEqual(2);
    }
  });

  it("quality preset has deepLaneRevisionBonus=0 (removes legacy +1)", () => {
    expect(getQualityProfile("quality").deepLaneRevisionBonus).toBe(0);
  });

  it("every preset has maxEvidenceAttempts >= 1", () => {
    for (const preset of ["quality", "balanced", "budget", "local-only"] as const) {
      const p = getQualityProfile(preset);
      expect(p.maxEvidenceAttempts).toBeGreaterThanOrEqual(1);
    }
  });

  it("quality preset caps evidence at 2 total attempts (1 initial + 1 incremental)", () => {
    expect(getQualityProfile("quality").maxEvidenceAttempts).toBe(2);
  });

  it("budget preset caps evidence at 1 attempt (no re-runs)", () => {
    expect(getQualityProfile("budget").maxEvidenceAttempts).toBe(1);
  });

  it("profiles are deeply frozen", () => {
    const q = getQualityProfile("quality") as QualityProfile & {
      forkWorkers: number;
    };
    expect(() => {
      q.forkWorkers = 999;
    }).toThrow();
  });
});

// Local re-export to keep the mutation test above type-safe
import type { QualityProfile } from "../quality-profile.js";
