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

  it("does not trigger L2 from revisionAttempt alone on the terminal attempt", () => {
    // revisionAttempt=3 == maxRevisionAttempts, so the pipeline has no
    // further retries. Running L2 would only label the page degraded.
    expect(
      selectVerificationLevel({
        lane: "standard",
        complexityScore: 5,
        signals: {},
        revisionAttempt: 3,
        maxRevisionAttempts: 3,
      }),
    ).toBe("L1");
  });

  it("still upgrades to L2 on the terminal attempt when genuine signals are present", () => {
    expect(
      selectVerificationLevel({
        lane: "standard",
        complexityScore: 5,
        signals: { factualRisksCount: 1 },
        revisionAttempt: 3,
        maxRevisionAttempts: 3,
      }),
    ).toBe("L2");
    expect(
      selectVerificationLevel({
        lane: "deep",
        complexityScore: 5,
        signals: {},
        revisionAttempt: 3,
        maxRevisionAttempts: 3,
      }),
    ).toBe("L2");
  });

  it("still triggers revisionAttempt-based L2 before the terminal attempt", () => {
    // revisionAttempt=2 < maxRevisionAttempts=3 — pipeline can still revise
    expect(
      selectVerificationLevel({
        lane: "standard",
        complexityScore: 5,
        signals: {},
        revisionAttempt: 2,
        maxRevisionAttempts: 3,
      }),
    ).toBe("L2");
  });

  it("is backward compatible when maxRevisionAttempts is omitted", () => {
    // Callers without budget awareness see the original revisionAttempt > 1 rule
    expect(
      selectVerificationLevel({
        lane: "standard",
        complexityScore: 5,
        signals: {},
        revisionAttempt: 3,
      }),
    ).toBe("L2");
  });
});
