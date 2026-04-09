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
