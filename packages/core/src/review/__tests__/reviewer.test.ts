import { describe, it, expect, vi, beforeEach } from "vitest";
import { FreshReviewer } from "../reviewer.js";
import type { ReviewBriefing } from "../../types/review.js";

vi.mock("ai", () => ({
  generateText: vi.fn(),
  jsonSchema: vi.fn((s: unknown) => s),
}));

const briefing: ReviewBriefing = {
  page_title: "Core Engine",
  section_position: "Page 2 of 5",
  current_page_plan: "Explain the core engine architecture and pipeline flow",
  full_book_summary: "A wiki covering setup, core engine, CLI, and web UI",
  current_draft: "# Core Engine\n\nThe engine orchestrates page generation.\n\n[cite:file:src/engine.ts:1-50]",
  citations: [{ kind: "file", target: "src/engine.ts", locator: "1-50", note: "Engine class" }],
  covered_files: ["src/engine.ts", "src/pipeline.ts"],
  review_questions: [
    "Does the page stay within scope?",
    "Are all key claims backed by citations?",
  ],
};

const passConclusion = JSON.stringify({
  verdict: "pass",
  blockers: [],
  factual_risks: [],
  missing_evidence: [],
  scope_violations: [],
  suggested_revisions: [],
});

const reviseConclusion = JSON.stringify({
  verdict: "revise",
  blockers: ["Missing explanation of error handling"],
  factual_risks: ["Claim about retry logic not backed by evidence"],
  missing_evidence: ["src/pipeline.ts not referenced"],
  scope_violations: [],
  suggested_revisions: ["Add a section on error propagation"],
});

describe("FreshReviewer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns pass verdict", async () => {
    const { generateText } = await import("ai");
    vi.mocked(generateText).mockResolvedValueOnce({
      text: passConclusion,
      usage: { inputTokens: 400, outputTokens: 100 },
    } as never);

    const reviewer = new FreshReviewer({
      model: {} as never,
      repoRoot: "/tmp/repo",
    });

    const result = await reviewer.review(briefing);
    expect(result.success).toBe(true);
    expect(result.conclusion!.verdict).toBe("pass");
    expect(result.conclusion!.blockers).toHaveLength(0);
  });

  it("returns revise verdict with details", async () => {
    const { generateText } = await import("ai");
    vi.mocked(generateText).mockResolvedValueOnce({
      text: reviseConclusion,
      usage: { inputTokens: 400, outputTokens: 200 },
    } as never);

    const reviewer = new FreshReviewer({
      model: {} as never,
      repoRoot: "/tmp/repo",
    });

    const result = await reviewer.review(briefing);
    expect(result.success).toBe(true);
    expect(result.conclusion!.verdict).toBe("revise");
    expect(result.conclusion!.blockers).toHaveLength(1);
    expect(result.conclusion!.missing_evidence).toHaveLength(1);
    expect(result.conclusion!.suggested_revisions).toHaveLength(1);
  });

  it("returns error on unparseable output", async () => {
    const { generateText } = await import("ai");
    vi.mocked(generateText).mockResolvedValueOnce({
      text: "I think it looks good overall.",
      usage: { inputTokens: 400, outputTokens: 50 },
    } as never);

    const reviewer = new FreshReviewer({
      model: {} as never,
      repoRoot: "/tmp/repo",
    });

    const result = await reviewer.review(briefing);
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});
