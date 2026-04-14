import { describe, it, expect, vi, beforeEach } from "vitest";
import { VerificationLadder } from "../verification-ladder.js";
import type { ReviewBriefing } from "../../types/review.js";

vi.mock("ai", () => {
  const generateText = vi.fn();
  return {
    generateText,
    streamText: vi.fn((...args: unknown[]) => {
      const p = generateText(...args);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const safe = (fn: (r: any) => any) => { const q = p.then(fn); q.catch(() => {}); return q; };
      return {
        text: safe((r) => r?.text ?? ""),
        finishReason: safe((r) => r?.finishReason ?? "stop"),
        usage: safe((r) => r?.usage ?? {}),
        toolCalls: safe((r) => r?.toolCalls ?? []),
        toolResults: safe((r) => r?.toolResults ?? []),
        steps: safe((r) => r?.steps ?? []),
        response: safe((r) => r?.response ?? {}),
        fullStream: (async function* () { const r = await p; if (r?.text) yield { type: "text-delta", textDelta: r.text }; })(),
      };
    }),
    jsonSchema: vi.fn((s: unknown) => s),
    stepCountIs: vi.fn(() => () => false),
  };
});

const briefing: ReviewBriefing = {
  page_title: "Test Page",
  section_position: "Page 1 of 3",
  current_page_plan: "Explain the test system",
  full_book_summary: "A wiki about testing",
  draft_file: "test/draft.md",
  covered_files: ["src/test.ts"],
  review_questions: ["Is it correct?"],
};

describe("VerificationLadder integration", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("L0 catches structural error without any LLM call", async () => {
    const ladder = new VerificationLadder({
      reviewerModel: {} as never,
      repoRoot: "/tmp/repo",
    });

    // No H1 heading → structure validator fails
    const result = await ladder.verify({
      level: "L0",
      briefing,
      draftContent: "no heading here",
      validationInput: {
        markdown: "no heading here",
        citations: [],
        knownFiles: [],
        knownPages: [],
        pageSlug: "test",
      },
    });

    expect(result.conclusion!.verdict).toBe("revise");
    expect(result.conclusion!.blockers.some(b => b.includes("missing H1 title"))).toBe(true);
    expect(result.metrics!.llmCalls).toBe(0);
  });

  it("L0 pass with valid structure, no LLM call", async () => {
    const ladder = new VerificationLadder({
      reviewerModel: {} as never,
      repoRoot: "/tmp/repo",
    });

    const result = await ladder.verify({
      level: "L0",
      briefing,
      draftContent: "# Test Page\n\nSome content that is long enough to pass the minimum length check for structure validation.",
      validationInput: {
        markdown: "# Test Page\n\nSome content that is long enough to pass the minimum length check for structure validation.",
        citations: [],
        knownFiles: [],
        knownPages: [],
        pageSlug: "test",
      },
    });

    expect(result.conclusion!.verdict).toBe("pass");
    expect(result.metrics!.llmCalls).toBe(0);
  });

  it("L1 makes exactly 1 LLM call", async () => {
    const { generateText } = await import("ai");
    vi.mocked(generateText).mockResolvedValueOnce({
      text: JSON.stringify({
        verdict: "pass",
        blockers: [],
        factual_risks: [],
        missing_evidence: [],
        scope_violations: [],
        suggested_revisions: [],
      }),
      usage: { inputTokens: 300, outputTokens: 80 },
    } as never);

    const ladder = new VerificationLadder({
      reviewerModel: {} as never,
      repoRoot: "/tmp/repo",
    });

    const result = await ladder.verify({
      level: "L1",
      briefing,
      draftContent: "# Test Page\n\n## Section\nContent with [cite:file:src/test.ts:1-10].",
      validationInput: {
        markdown: "# Test Page\n\n## Section\nContent with [cite:file:src/test.ts:1-10].",
        citations: [{ kind: "file" as const, target: "src/test.ts", locator: "1-10" }],
        knownFiles: ["src/test.ts"],
        knownPages: [],
        pageSlug: "test",
      },
    });

    expect(result.conclusion!.verdict).toBe("pass");
    expect(result.metrics!.llmCalls).toBe(1);
    expect(result.levelReached).toBe("L1");
  });

  it("L2 makes 2 LLM calls (L1 + L2) when L1 passes", async () => {
    const { generateText } = await import("ai");
    // L1 call
    vi.mocked(generateText).mockResolvedValueOnce({
      text: JSON.stringify({ verdict: "pass", blockers: [], factual_risks: [], missing_evidence: [], scope_violations: [], suggested_revisions: [] }),
      usage: { inputTokens: 300, outputTokens: 80 },
    } as never);
    // L2 call
    vi.mocked(generateText).mockResolvedValueOnce({
      text: JSON.stringify({ verdict: "pass", blockers: [], factual_risks: [], missing_evidence: [], scope_violations: [], suggested_revisions: [] }),
      usage: { inputTokens: 600, outputTokens: 150 },
    } as never);

    const ladder = new VerificationLadder({
      reviewerModel: {} as never,
      repoRoot: "/tmp/repo",
    });

    const result = await ladder.verify({
      level: "L2",
      briefing,
      draftContent: "# Test Page\n\n## Section\nContent with [cite:file:src/test.ts:1-10].",
      validationInput: {
        markdown: "# Test Page\n\n## Section\nContent with [cite:file:src/test.ts:1-10].",
        citations: [{ kind: "file" as const, target: "src/test.ts", locator: "1-10" }],
        knownFiles: ["src/test.ts"],
        knownPages: [],
        pageSlug: "test",
      },
    });

    expect(result.conclusion!.verdict).toBe("pass");
    expect(result.metrics!.llmCalls).toBe(2);
    expect(result.levelReached).toBe("L2");
  });
});
