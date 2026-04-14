import { describe, it, expect } from "vitest";
import { selectVerificationLevel } from "../verification-level.js";

describe("selectVerificationLevel", () => {
  it("returns L0 for fast lane with low complexity", () => {
    expect(
      selectVerificationLevel({
        lane: "fast",
        complexityScore: 3,
        signals: {},
        revisionAttempt: 0,
      }),
    ).toBe("L0");
  });

  it("returns L1 for standard lane with moderate complexity", () => {
    expect(
      selectVerificationLevel({
        lane: "standard",
        complexityScore: 8,
        signals: {},
        revisionAttempt: 0,
      }),
    ).toBe("L1");
  });

  it("returns L1 for fast lane with complexity > 4", () => {
    expect(
      selectVerificationLevel({
        lane: "fast",
        complexityScore: 5,
        signals: {},
        revisionAttempt: 0,
      }),
    ).toBe("L1");
  });

  it("returns L2 for deep lane", () => {
    expect(
      selectVerificationLevel({
        lane: "deep",
        complexityScore: 20,
        signals: {},
        revisionAttempt: 0,
      }),
    ).toBe("L2");
  });

  it("upgrades to L2 when complexity >= 12", () => {
    expect(
      selectVerificationLevel({
        lane: "standard",
        complexityScore: 12,
        signals: {},
        revisionAttempt: 0,
      }),
    ).toBe("L2");
  });

  it("upgrades to L2 when factualRisksCount > 0", () => {
    expect(
      selectVerificationLevel({
        lane: "standard",
        complexityScore: 5,
        signals: { factualRisksCount: 2 },
        revisionAttempt: 0,
      }),
    ).toBe("L2");
  });

  it("upgrades to L2 when missingEvidenceCount > 0", () => {
    expect(
      selectVerificationLevel({
        lane: "standard",
        complexityScore: 5,
        signals: { missingEvidenceCount: 1 },
        revisionAttempt: 0,
      }),
    ).toBe("L2");
  });

  it("upgrades to L2 when draftTruncated", () => {
    expect(
      selectVerificationLevel({
        lane: "standard",
        complexityScore: 5,
        signals: { draftTruncated: true },
        revisionAttempt: 0,
      }),
    ).toBe("L2");
  });

  it("upgrades to L2 when revision attempt > 1", () => {
    expect(
      selectVerificationLevel({
        lane: "standard",
        complexityScore: 5,
        signals: {},
        revisionAttempt: 2,
      }),
    ).toBe("L2");
  });

  it("upgrades to L2 when lowCitationDensity", () => {
    expect(
      selectVerificationLevel({
        lane: "standard",
        complexityScore: 5,
        signals: { lowCitationDensity: true },
        revisionAttempt: 0,
      }),
    ).toBe("L2");
  });

  it("L2 upgrade overrides L0 for fast lane with high-risk signals", () => {
    expect(
      selectVerificationLevel({
        lane: "fast",
        complexityScore: 3,
        signals: { factualRisksCount: 1 },
        revisionAttempt: 0,
      }),
    ).toBe("L2");
  });
});
