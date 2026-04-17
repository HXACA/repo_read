import { describe, it, expect, vi, beforeEach } from "vitest";
import { VerificationLadder } from "../verification-ladder.js";
import type { ReviewBriefing } from "../../types/review.js";
import type { ValidationReport } from "../../types/validation.js";
import type { ReviewResult } from "../reviewer.js";

const mockL1Review = vi.fn<() => Promise<ReviewResult>>();
const mockL2Review = vi.fn<() => Promise<ReviewResult>>();
const mockValidatePage = vi.fn<(input: unknown) => ValidationReport>();

vi.mock("../l1-semantic-reviewer.js", () => ({
  L1SemanticReviewer: vi.fn().mockImplementation(() => ({
    review: mockL1Review,
  })),
}));

vi.mock("../reviewer.js", () => ({
  FreshReviewer: vi.fn().mockImplementation(() => ({
    review: mockL2Review,
  })),
}));

vi.mock("../../validation/page-validator.js", () => ({
  validatePage: (input: unknown) => mockValidatePage(input),
}));

const briefing: ReviewBriefing = {
  page_title: "Test Page",
  section_position: "Page 1 of 3",
  current_page_plan: "Test plan",
  full_book_summary: "Test summary",
  draft_file: "test/draft.md",
  covered_files: ["src/a.ts"],
  review_questions: ["Is it correct?"],
};

const passL0: ValidationReport = {
  target: "page",
  passed: true,
  errors: [],
  warnings: [],
};
const failL0: ValidationReport = {
  target: "page",
  passed: false,
  errors: ["missing H1 title"],
  warnings: [],
};
const passL1: ReviewResult = {
  success: true,
  conclusion: {
    verdict: "pass",
    blockers: [],
    factual_risks: [],
    missing_evidence: [],
    scope_violations: [],
    suggested_revisions: [],
  },
  metrics: {
    llmCalls: 1,
    usage: {
      inputTokens: 200,
      outputTokens: 50,
      reasoningTokens: 0,
      cachedTokens: 0,
    },
  },
};
const reviseL1: ReviewResult = {
  success: true,
  conclusion: {
    verdict: "revise",
    blockers: ["Scope drift"],
    factual_risks: [],
    missing_evidence: [],
    scope_violations: ["Discusses deployment"],
    suggested_revisions: [],
  },
  metrics: {
    llmCalls: 1,
    usage: {
      inputTokens: 200,
      outputTokens: 80,
      reasoningTokens: 0,
      cachedTokens: 0,
    },
  },
};
const passL2: ReviewResult = {
  success: true,
  conclusion: {
    verdict: "pass",
    blockers: [],
    factual_risks: [],
    missing_evidence: [],
    scope_violations: [],
    suggested_revisions: [],
  },
  metrics: {
    llmCalls: 1,
    usage: {
      inputTokens: 500,
      outputTokens: 200,
      reasoningTokens: 0,
      cachedTokens: 0,
    },
  },
};

describe("VerificationLadder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("L0 only: returns pass when validation passes, skips L1 and L2", async () => {
    mockValidatePage.mockReturnValue(passL0);
    const ladder = new VerificationLadder({
      reviewerModel: {} as never,
      repoRoot: "/tmp/repo",
    });
    const result = await ladder.verify({
      level: "L0",
      briefing,
      draftContent: "# Title\nContent",
      validationInput: {
        markdown: "# Title\nContent",
        citations: [],
        knownFiles: ["src/a.ts"],
        knownPages: [],
        pageSlug: "test",
      },
    });
    expect(result.conclusion!.verdict).toBe("pass");
    expect(result.levelReached).toBe("L0");
    expect(mockL1Review).not.toHaveBeenCalled();
    expect(mockL2Review).not.toHaveBeenCalled();
  });

  it("L0 only: returns revise with blockers when validation fails", async () => {
    mockValidatePage.mockReturnValue(failL0);
    const ladder = new VerificationLadder({
      reviewerModel: {} as never,
      repoRoot: "/tmp/repo",
    });
    const result = await ladder.verify({
      level: "L0",
      briefing,
      draftContent: "no heading",
      validationInput: {
        markdown: "no heading",
        citations: [],
        knownFiles: [],
        knownPages: [],
        pageSlug: "test",
      },
    });
    expect(result.conclusion!.verdict).toBe("revise");
    expect(result.conclusion!.blockers.length).toBeGreaterThan(0);
    expect(result.levelReached).toBe("L0");
  });

  it("L1: runs L0 then L1, merges results", async () => {
    mockValidatePage.mockReturnValue(passL0);
    mockL1Review.mockResolvedValue(passL1);
    const ladder = new VerificationLadder({
      reviewerModel: {} as never,
      repoRoot: "/tmp/repo",
    });
    const result = await ladder.verify({
      level: "L1",
      briefing,
      draftContent: "# Title\nContent",
      validationInput: {
        markdown: "# Title\nContent",
        citations: [],
        knownFiles: [],
        knownPages: [],
        pageSlug: "test",
      },
    });
    expect(result.conclusion!.verdict).toBe("pass");
    expect(result.levelReached).toBe("L1");
    expect(mockL1Review).toHaveBeenCalledOnce();
    expect(mockL2Review).not.toHaveBeenCalled();
  });

  it("L1 revise: propagates L1 blockers", async () => {
    mockValidatePage.mockReturnValue(passL0);
    mockL1Review.mockResolvedValue(reviseL1);
    const ladder = new VerificationLadder({
      reviewerModel: {} as never,
      repoRoot: "/tmp/repo",
    });
    const result = await ladder.verify({
      level: "L1",
      briefing,
      draftContent: "# Title\nContent",
      validationInput: {
        markdown: "# Title\nContent",
        citations: [],
        knownFiles: [],
        knownPages: [],
        pageSlug: "test",
      },
    });
    expect(result.conclusion!.verdict).toBe("revise");
    expect(result.conclusion!.blockers).toContain("Scope drift");
    expect(result.levelReached).toBe("L1");
  });

  it("L2: runs L0 + L1 + L2", async () => {
    mockValidatePage.mockReturnValue(passL0);
    mockL1Review.mockResolvedValue(passL1);
    mockL2Review.mockResolvedValue(passL2);
    const ladder = new VerificationLadder({
      reviewerModel: {} as never,
      repoRoot: "/tmp/repo",
    });
    const result = await ladder.verify({
      level: "L2",
      briefing,
      draftContent: "# Title\nContent",
      validationInput: {
        markdown: "# Title\nContent",
        citations: [],
        knownFiles: [],
        knownPages: [],
        pageSlug: "test",
      },
    });
    expect(result.conclusion!.verdict).toBe("pass");
    expect(result.levelReached).toBe("L2");
    expect(mockL1Review).toHaveBeenCalledOnce();
    expect(mockL2Review).toHaveBeenCalledOnce();
  });

  it("L2: short-circuits at L1 when L1 returns revise (no L2 waste)", async () => {
    mockValidatePage.mockReturnValue(passL0);
    mockL1Review.mockResolvedValue(reviseL1);
    const ladder = new VerificationLadder({
      reviewerModel: {} as never,
      repoRoot: "/tmp/repo",
    });
    const result = await ladder.verify({
      level: "L2",
      briefing,
      draftContent: "# Title\nContent",
      validationInput: {
        markdown: "# Title\nContent",
        citations: [],
        knownFiles: [],
        knownPages: [],
        pageSlug: "test",
      },
    });
    expect(result.conclusion!.verdict).toBe("revise");
    expect(result.levelReached).toBe("L1");
    expect(mockL2Review).not.toHaveBeenCalled();
  });

  it("L0 failure with L1 selected: merges L0 errors as blockers, still runs L1", async () => {
    mockValidatePage.mockReturnValue(failL0);
    mockL1Review.mockResolvedValue(passL1);
    const ladder = new VerificationLadder({
      reviewerModel: {} as never,
      repoRoot: "/tmp/repo",
    });
    const result = await ladder.verify({
      level: "L1",
      briefing,
      draftContent: "no heading",
      validationInput: {
        markdown: "no heading",
        citations: [],
        knownFiles: [],
        knownPages: [],
        pageSlug: "test",
      },
    });
    expect(result.conclusion!.verdict).toBe("revise");
    expect(
      result.conclusion!.blockers.some((b) => b.includes("missing H1 title")),
    ).toBe(true);
    expect(result.levelReached).toBe("L1");
  });

  it("L2: proceeds to L2 when L1 fails (graceful degradation)", async () => {
    mockValidatePage.mockReturnValue(passL0);
    mockL1Review.mockResolvedValue({
      success: false,
      error: "L1 review failed: API error",
    });
    mockL2Review.mockResolvedValue(passL2);
    const ladder = new VerificationLadder({
      reviewerModel: {} as never,
      repoRoot: "/tmp/repo",
    });
    const result = await ladder.verify({
      level: "L2",
      briefing,
      draftContent: "# Title\nContent",
      validationInput: {
        markdown: "# Title\nContent",
        citations: [],
        knownFiles: [],
        knownPages: [],
        pageSlug: "test",
      },
    });
    // L1 failed → defaults to pass conclusion → no blockers → proceeds to L2
    expect(result.levelReached).toBe("L2");
    expect(result.conclusion!.verdict).toBe("pass");
    expect(mockL2Review).toHaveBeenCalledOnce();
  });

  it("L0 failure with L2 selected: short-circuits at L1 (L0 errors become blockers)", async () => {
    mockValidatePage.mockReturnValue(failL0);
    mockL1Review.mockResolvedValue(passL1);
    const ladder = new VerificationLadder({
      reviewerModel: {} as never,
      repoRoot: "/tmp/repo",
    });
    const result = await ladder.verify({
      level: "L2",
      briefing,
      draftContent: "no heading",
      validationInput: {
        markdown: "no heading",
        citations: [],
        knownFiles: [],
        knownPages: [],
        pageSlug: "test",
      },
    });
    // L0 errors merge as blockers → merged verdict is "revise" → short-circuits before L2
    expect(result.conclusion!.verdict).toBe("revise");
    expect(result.conclusion!.blockers.some((b) => b.includes("missing H1 title"))).toBe(true);
    expect(result.levelReached).toBe("L1");
    expect(mockL2Review).not.toHaveBeenCalled();
  });

  it("L1 failure at level=L1: propagates failure for pipeline degradation", async () => {
    mockValidatePage.mockReturnValue(passL0);
    mockL1Review.mockResolvedValue({
      success: false,
      error: "L1 review failed: API error",
    });
    const ladder = new VerificationLadder({
      reviewerModel: {} as never,
      repoRoot: "/tmp/repo",
    });
    const result = await ladder.verify({
      level: "L1",
      briefing,
      draftContent: "# Title\nContent",
      validationInput: {
        markdown: "# Title\nContent",
        citations: [],
        knownFiles: [],
        knownPages: [],
        pageSlug: "test",
      },
    });
    // Must propagate failure so pipeline synthesizes unverified pass
    expect(result.success).toBe(false);
    expect(result.error).toContain("L1");
    expect(result.conclusion).toBeUndefined();
    expect(result.levelReached).toBe("L1");
    expect(mockL2Review).not.toHaveBeenCalled();
  });

  it("L2: merges L1 non-blocker findings into L2 conclusion", async () => {
    mockValidatePage.mockReturnValue(passL0);
    mockL1Review.mockResolvedValue({
      success: true,
      conclusion: {
        verdict: "pass",
        blockers: [],
        factual_risks: ["Section X claims 10ms latency without citation"],
        missing_evidence: ["No evidence for caching behavior"],
        scope_violations: ["Brief mention of deployment"],
        suggested_revisions: ["Consider adding a caching example"],
      },
      metrics: { llmCalls: 1, usage: { inputTokens: 200, outputTokens: 80, reasoningTokens: 0, cachedTokens: 0 } },
    });
    mockL2Review.mockResolvedValue({
      success: true,
      conclusion: {
        verdict: "pass",
        blockers: [],
        factual_risks: ["Function signature mismatch at line 42"],
        missing_evidence: [],
        scope_violations: [],
        suggested_revisions: ["Fix line 42 signature"],
      },
      metrics: { llmCalls: 1, usage: { inputTokens: 500, outputTokens: 200, reasoningTokens: 0, cachedTokens: 0 } },
    });
    const ladder = new VerificationLadder({
      reviewerModel: {} as never,
      repoRoot: "/tmp/repo",
    });
    const result = await ladder.verify({
      level: "L2",
      briefing,
      draftContent: "# Title\nContent",
      validationInput: {
        markdown: "# Title\nContent",
        citations: [],
        knownFiles: [],
        knownPages: [],
        pageSlug: "test",
      },
    });
    expect(result.conclusion!.verdict).toBe("pass");
    // L1 findings merged into L2 conclusion
    expect(result.conclusion!.factual_risks).toContain("Section X claims 10ms latency without citation");
    expect(result.conclusion!.factual_risks).toContain("Function signature mismatch at line 42");
    expect(result.conclusion!.missing_evidence).toContain("No evidence for caching behavior");
    expect(result.conclusion!.scope_violations).toContain("Brief mention of deployment");
    // L1 suggested_revisions also merged
    expect(result.conclusion!.suggested_revisions).toContain("Consider adding a caching example");
    expect(result.conclusion!.suggested_revisions).toContain("Fix line 42 signature");
  });

  it("accumulates metrics across levels", async () => {
    mockValidatePage.mockReturnValue(passL0);
    mockL1Review.mockResolvedValue(passL1);
    mockL2Review.mockResolvedValue(passL2);
    const ladder = new VerificationLadder({
      reviewerModel: {} as never,
      repoRoot: "/tmp/repo",
    });
    const result = await ladder.verify({
      level: "L2",
      briefing,
      draftContent: "# Title\nContent",
      validationInput: {
        markdown: "# Title\nContent",
        citations: [],
        knownFiles: [],
        knownPages: [],
        pageSlug: "test",
      },
    });
    expect(result.metrics!.llmCalls).toBe(2);
    expect(result.metrics!.usage.inputTokens).toBe(700);
    expect(result.metrics!.usage.outputTokens).toBe(250);
  });

  it("merges missing_coverage from L1 and L2 with dedup", async () => {
    mockValidatePage.mockReturnValue(passL0);
    mockL1Review.mockResolvedValue({
      success: true,
      conclusion: {
        verdict: "pass",
        blockers: [],
        factual_risks: [],
        missing_evidence: [],
        scope_violations: [],
        suggested_revisions: [],
        missing_coverage: ["a", "b"],
      },
      metrics: { llmCalls: 1, usage: { inputTokens: 200, outputTokens: 80, reasoningTokens: 0, cachedTokens: 0 } },
    });
    mockL2Review.mockResolvedValue({
      success: true,
      conclusion: {
        verdict: "pass",
        blockers: [],
        factual_risks: [],
        missing_evidence: [],
        scope_violations: [],
        suggested_revisions: [],
        missing_coverage: ["b", "c"],
      },
      metrics: { llmCalls: 1, usage: { inputTokens: 500, outputTokens: 200, reasoningTokens: 0, cachedTokens: 0 } },
    });
    const ladder = new VerificationLadder({
      reviewerModel: {} as never,
      repoRoot: "/tmp/repo",
    });
    const result = await ladder.verify({
      level: "L2",
      briefing,
      draftContent: "# Title\nContent",
      validationInput: {
        markdown: "# Title\nContent",
        citations: [],
        knownFiles: [],
        knownPages: [],
        pageSlug: "test",
      },
    });
    expect(result.conclusion!.verdict).toBe("pass");
    // missing_coverage should be deduped union: ["a", "b", "c"]
    expect(result.conclusion!.missing_coverage).toContain("a");
    expect(result.conclusion!.missing_coverage).toContain("b");
    expect(result.conclusion!.missing_coverage).toContain("c");
    expect(result.conclusion!.missing_coverage!.length).toBe(3);
  });

  it("forwards missing_coverage when short-circuiting after L1", async () => {
    mockValidatePage.mockReturnValue(passL0);
    mockL1Review.mockResolvedValue({
      success: true,
      conclusion: {
        verdict: "revise",
        blockers: ["Scope drift"],
        factual_risks: [],
        missing_evidence: [],
        scope_violations: ["Discusses deployment"],
        suggested_revisions: [],
        missing_coverage: ["x"],
      },
      metrics: { llmCalls: 1, usage: { inputTokens: 200, outputTokens: 80, reasoningTokens: 0, cachedTokens: 0 } },
    });
    const ladder = new VerificationLadder({
      reviewerModel: {} as never,
      repoRoot: "/tmp/repo",
    });
    const result = await ladder.verify({
      level: "L2",
      briefing,
      draftContent: "# Title\nContent",
      validationInput: {
        markdown: "# Title\nContent",
        citations: [],
        knownFiles: [],
        knownPages: [],
        pageSlug: "test",
      },
    });
    expect(result.levelReached).toBe("L1");
    expect(result.conclusion!.missing_coverage).toEqual(["x"]);
  });
});
