import { describe, it, expect, vi, beforeEach } from "vitest";
import { FreshReviewer } from "../reviewer.js";
import type { ReviewBriefing } from "../../types/review.js";

vi.mock("ai", () => {
  const generateText = vi.fn();
  return {
    generateText,
    streamText: vi.fn((...args: unknown[]) => {
      const p = generateText(...args);
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

  it("gracefully handles unparseable output as pass", async () => {
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
    // Fallback: treat unparseable as pass
    expect(result.success).toBe(true);
    expect(result.conclusion!.verdict).toBe("pass");
  });

  it("parses verified_citations and preserves match entries", async () => {
    const { generateText } = await import("ai");
    vi.mocked(generateText).mockResolvedValueOnce({
      text: JSON.stringify({
        verdict: "pass",
        blockers: [],
        factual_risks: [],
        missing_evidence: [],
        scope_violations: [],
        suggested_revisions: [],
        verified_citations: [
          {
            citation: { kind: "file", target: "src/engine.ts", locator: "1-50" },
            status: "match",
          },
        ],
      }),
    } as never);

    const reviewer = new FreshReviewer({
      model: {} as never,
      repoRoot: "/tmp/repo",
      verifyMinCitations: 1,
    });

    const result = await reviewer.review(briefing);
    expect(result.conclusion!.verdict).toBe("pass");
    expect(result.conclusion!.verified_citations).toHaveLength(1);
    expect(result.conclusion!.verified_citations![0].status).toBe("match");
  });

  it("promotes mismatch to blockers and forces revise verdict", async () => {
    const { generateText } = await import("ai");
    vi.mocked(generateText).mockResolvedValueOnce({
      text: JSON.stringify({
        verdict: "pass", // reviewer forgot to downgrade
        blockers: [],
        factual_risks: [],
        missing_evidence: [],
        scope_violations: [],
        suggested_revisions: [],
        verified_citations: [
          {
            citation: { kind: "file", target: "src/engine.ts", locator: "1-50" },
            status: "mismatch",
            note: "class not found",
          },
        ],
      }),
    } as never);

    const reviewer = new FreshReviewer({
      model: {} as never,
      repoRoot: "/tmp/repo",
      verifyMinCitations: 1,
    });

    const result = await reviewer.review(briefing);
    // Defensive promotion: mismatch forces revise + adds blocker
    expect(result.conclusion!.verdict).toBe("revise");
    expect(result.conclusion!.blockers.length).toBeGreaterThan(0);
    expect(result.conclusion!.blockers[0]).toContain("src/engine.ts");
  });

  it("promotes not_found to blockers", async () => {
    const { generateText } = await import("ai");
    vi.mocked(generateText).mockResolvedValueOnce({
      text: JSON.stringify({
        verdict: "revise",
        blockers: [],
        factual_risks: [],
        missing_evidence: [],
        scope_violations: [],
        suggested_revisions: [],
        verified_citations: [
          {
            citation: { kind: "file", target: "missing/path.ts", locator: "1-10" },
            status: "not_found",
          },
        ],
      }),
    } as never);

    const reviewer = new FreshReviewer({
      model: {} as never,
      repoRoot: "/tmp/repo",
      verifyMinCitations: 1,
    });

    const result = await reviewer.review(briefing);
    expect(result.conclusion!.verdict).toBe("revise");
    expect(result.conclusion!.blockers.some((b) => b.includes("missing/path.ts"))).toBe(true);
  });

  it("strictness=strict changes rule 6 phrasing", async () => {
    const { generateText } = await import("ai");
    const spy = vi.mocked(generateText);
    spy.mockResolvedValueOnce({
      text: passConclusion,
    } as never);

    const reviewer = new FreshReviewer({
      model: {} as never,
      repoRoot: "/tmp/repo",
      strictness: "strict",
    });
    await reviewer.review(briefing);
    const call = spy.mock.calls[0][0] as { system?: string };
    expect(call.system).toContain("err on the side of rejection");
    expect(call.system).not.toContain("Even minor factual risks do not require");
  });

  it("strictness=lenient changes rule 6 phrasing", async () => {
    const { generateText } = await import("ai");
    const spy = vi.mocked(generateText);
    spy.mockResolvedValueOnce({
      text: passConclusion,
    } as never);

    const reviewer = new FreshReviewer({
      model: {} as never,
      repoRoot: "/tmp/repo",
      strictness: "lenient",
    });
    await reviewer.review(briefing);
    const call = spy.mock.calls[0][0] as { system?: string };
    expect(call.system).toContain("HARD blockers that would actively mislead");
    expect(call.system).not.toContain("err on the side of rejection");
  });

  it("strictness defaults to normal", async () => {
    const { generateText } = await import("ai");
    const spy = vi.mocked(generateText);
    spy.mockResolvedValueOnce({
      text: passConclusion,
    } as never);

    const reviewer = new FreshReviewer({
      model: {} as never,
      repoRoot: "/tmp/repo",
    });
    await reviewer.review(briefing);
    const call = spy.mock.calls[0][0] as { system?: string };
    expect(call.system).toContain(
      "Even minor factual risks do not require",
    );
  });

  it("verifyMinCitations=0 does not add the verification block", async () => {
    // When minCitations is 0, the prompt should not mention verification at all.
    // We can verify by checking that a call with only old-style fields still passes.
    const { generateText } = await import("ai");
    const spy = vi.mocked(generateText);
    spy.mockResolvedValueOnce({
      text: JSON.stringify({
        verdict: "pass",
        blockers: [],
        factual_risks: [],
        missing_evidence: [],
        scope_violations: [],
        suggested_revisions: [],
      }),
    } as never);

    const reviewer = new FreshReviewer({
      model: {} as never,
      repoRoot: "/tmp/repo",
      verifyMinCitations: 0,
    });

    await reviewer.review(briefing);
    const call = spy.mock.calls[0][0] as { system?: string };
    expect(call.system).not.toContain("Verification Requirement");
  });
});
