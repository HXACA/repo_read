import { describe, it, expect } from "vitest";
import { parseFreshReviewerOutput } from "../reviewer.js";
import { parseL1SemanticReviewerOutput } from "../l1-semantic-reviewer.js";

describe("parseFreshReviewerOutput — missing_coverage handling", () => {
  it("reports missing_coverage as data; verdict follows LLM, not forced by coverage", () => {
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
    // Reviewer does NOT force verdict when only missing_coverage is non-empty;
    // the pipeline decides based on qp.coverageEnforcement.
    expect(result.conclusion!.verdict).toBe("pass");
    expect(result.conclusion!.missing_coverage).toEqual([
      "file:foo.ts",
      "file:bar.ts",
    ]);
    // No coverage markers auto-promoted into blockers.
    expect(result.conclusion!.blockers).toEqual([]);
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

  it("preserves LLM-supplied coverage-mention blockers verbatim (no auto-promotion, no dedup)", () => {
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

    // Reviewer no longer auto-promotes missing_coverage into blockers, so
    // the only coverage-marked blocker is the one the LLM itself supplied.
    const coverageBlockers = result.conclusion!.blockers.filter((b) =>
      b.includes("[coverage:file:foo.ts]"),
    );
    expect(coverageBlockers).toHaveLength(1);
    // Verdict stays "revise" because the LLM said so (blockers.length > 0 also triggers it).
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
  it("reports missing_coverage as data; verdict follows LLM, not forced by coverage", () => {
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
    // Reviewer does NOT force verdict when only missing_coverage is non-empty;
    // the pipeline decides based on qp.coverageEnforcement.
    expect(result.conclusion!.verdict).toBe("pass");
    expect(result.conclusion!.missing_coverage).toEqual([
      "file:foo.ts",
      "file:bar.ts",
    ]);
    // No coverage markers auto-promoted into blockers.
    expect(result.conclusion!.blockers).toEqual([]);
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

  it("preserves other fields alongside missing_coverage (no coverage auto-promotion)", () => {
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

    // Verdict stays "revise" because LLM said so (and blockers is non-empty).
    expect(result.conclusion!.verdict).toBe("revise");
    expect(result.conclusion!.factual_risks).toEqual(["risk A"]);
    expect(result.conclusion!.missing_evidence).toEqual(["evidence B"]);
    expect(result.conclusion!.scope_violations).toEqual(["scope C"]);
    expect(result.conclusion!.suggested_revisions).toEqual(["fix X"]);
    expect(result.conclusion!.missing_coverage).toEqual(["file:foo.ts"]);
    // Blockers contain only what the LLM supplied — no coverage marker injected.
    expect(result.conclusion!.blockers).toEqual(["Explicit blocker"]);
    expect(
      result.conclusion!.blockers.some((b) =>
        b.includes("[coverage:file:foo.ts]"),
      ),
    ).toBe(false);
  });
});
