import { describe, it, expect } from "vitest";
import { parseFreshReviewerOutput } from "../reviewer.js";
import { parseL1SemanticReviewerOutput } from "../l1-semantic-reviewer.js";

describe("parseFreshReviewerOutput — missing_coverage handling", () => {
  it("promotes missing_coverage entries into blockers and forces verdict=revise", () => {
    const result = parseFreshReviewerOutput(
      JSON.stringify({
        verdict: "pass",
        blockers: [],
        factual_risks: [],
        missing_evidence: [],
        scope_violations: [],
        missing_coverage: ["file:foo.ts", "file:bar.ts"],
        suggested_revisions: [],
      }),
    );

    expect(result.success).toBe(true);
    expect(result.conclusion!.verdict).toBe("revise");
    expect(result.conclusion!.missing_coverage).toEqual([
      "file:foo.ts",
      "file:bar.ts",
    ]);
    expect(result.conclusion!.blockers).toEqual(
      expect.arrayContaining([
        expect.stringContaining("[coverage:file:foo.ts]"),
        expect.stringContaining("[coverage:file:bar.ts]"),
      ]),
    );
  });

  it("keeps verdict=pass when missing_coverage is empty", () => {
    const result = parseFreshReviewerOutput(
      JSON.stringify({
        verdict: "pass",
        blockers: [],
        factual_risks: [],
        missing_evidence: [],
        scope_violations: [],
        missing_coverage: [],
        suggested_revisions: [],
      }),
    );

    expect(result.conclusion!.verdict).toBe("pass");
    expect(result.conclusion!.missing_coverage).toEqual([]);
    expect(result.conclusion!.blockers).toEqual([]);
  });

  it("defaults to empty array when missing_coverage is not an array", () => {
    const result = parseFreshReviewerOutput(
      JSON.stringify({
        verdict: "pass",
        blockers: [],
        factual_risks: [],
        missing_evidence: [],
        scope_violations: [],
        missing_coverage: "not an array",
        suggested_revisions: [],
      }),
    );

    expect(result.conclusion!.missing_coverage).toEqual([]);
    expect(result.conclusion!.verdict).toBe("pass");
  });

  it("omits missing_coverage field entirely defaults to []", () => {
    const result = parseFreshReviewerOutput(
      JSON.stringify({
        verdict: "pass",
        blockers: [],
        factual_risks: [],
        missing_evidence: [],
        scope_violations: [],
        suggested_revisions: [],
      }),
    );

    expect(result.conclusion!.missing_coverage).toEqual([]);
    expect(result.conclusion!.verdict).toBe("pass");
  });

  it("does not duplicate coverage blocker when already present", () => {
    const result = parseFreshReviewerOutput(
      JSON.stringify({
        verdict: "revise",
        blockers: ["Existing [coverage:file:foo.ts] already flagged manually"],
        factual_risks: [],
        missing_evidence: [],
        scope_violations: [],
        missing_coverage: ["file:foo.ts"],
        suggested_revisions: [],
      }),
    );

    const coverageBlockers = result.conclusion!.blockers.filter((b) =>
      b.includes("[coverage:file:foo.ts]"),
    );
    expect(coverageBlockers).toHaveLength(1);
    expect(result.conclusion!.verdict).toBe("revise");
  });

  it("falls back to pass + empty missing_coverage on unparseable output", () => {
    const result = parseFreshReviewerOutput("not JSON at all");

    expect(result.success).toBe(true);
    expect(result.conclusion!.verdict).toBe("pass");
    expect(result.conclusion!.missing_coverage).toEqual([]);
  });

  it("filters non-string entries from missing_coverage", () => {
    const result = parseFreshReviewerOutput(
      JSON.stringify({
        verdict: "pass",
        blockers: [],
        missing_coverage: ["file:foo.ts", 42, null, { x: 1 }, "file:bar.ts"],
      }),
    );

    expect(result.conclusion!.missing_coverage).toEqual([
      "file:foo.ts",
      "file:bar.ts",
    ]);
  });
});

describe("parseL1SemanticReviewerOutput — missing_coverage handling", () => {
  it("promotes missing_coverage entries into blockers and forces verdict=revise", () => {
    const result = parseL1SemanticReviewerOutput(
      JSON.stringify({
        verdict: "pass",
        blockers: [],
        factual_risks: [],
        missing_evidence: [],
        scope_violations: [],
        missing_coverage: ["file:foo.ts", "file:bar.ts"],
        suggested_revisions: [],
      }),
    );

    expect(result.success).toBe(true);
    expect(result.conclusion!.verdict).toBe("revise");
    expect(result.conclusion!.missing_coverage).toEqual([
      "file:foo.ts",
      "file:bar.ts",
    ]);
    expect(result.conclusion!.blockers).toEqual(
      expect.arrayContaining([
        expect.stringContaining("[coverage:file:foo.ts]"),
        expect.stringContaining("[coverage:file:bar.ts]"),
      ]),
    );
  });

  it("keeps verdict=pass when missing_coverage is empty", () => {
    const result = parseL1SemanticReviewerOutput(
      JSON.stringify({
        verdict: "pass",
        blockers: [],
        factual_risks: [],
        missing_evidence: [],
        scope_violations: [],
        missing_coverage: [],
        suggested_revisions: [],
      }),
    );

    expect(result.conclusion!.verdict).toBe("pass");
    expect(result.conclusion!.missing_coverage).toEqual([]);
  });

  it("defaults to empty array when missing_coverage is not an array", () => {
    const result = parseL1SemanticReviewerOutput(
      JSON.stringify({
        verdict: "pass",
        blockers: [],
        missing_coverage: 12345,
      }),
    );

    expect(result.conclusion!.missing_coverage).toEqual([]);
  });

  it("unparseable output → pass with empty missing_coverage", () => {
    const result = parseL1SemanticReviewerOutput("totally not JSON");

    expect(result.conclusion!.verdict).toBe("pass");
    expect(result.conclusion!.missing_coverage).toEqual([]);
  });

  it("preserves other fields alongside missing_coverage", () => {
    const result = parseL1SemanticReviewerOutput(
      JSON.stringify({
        verdict: "revise",
        blockers: ["Explicit blocker"],
        factual_risks: ["risk A"],
        missing_evidence: ["evidence B"],
        scope_violations: ["scope C"],
        missing_coverage: ["file:foo.ts"],
        suggested_revisions: ["fix X"],
      }),
    );

    expect(result.conclusion!.verdict).toBe("revise");
    expect(result.conclusion!.factual_risks).toEqual(["risk A"]);
    expect(result.conclusion!.missing_evidence).toEqual(["evidence B"]);
    expect(result.conclusion!.scope_violations).toEqual(["scope C"]);
    expect(result.conclusion!.suggested_revisions).toEqual(["fix X"]);
    expect(result.conclusion!.blockers).toContain("Explicit blocker");
    expect(
      result.conclusion!.blockers.some((b) =>
        b.includes("[coverage:file:foo.ts]"),
      ),
    ).toBe(true);
  });
});
