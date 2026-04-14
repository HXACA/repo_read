import { describe, it, expect, vi, beforeEach } from "vitest";
import { L1SemanticReviewer } from "../l1-semantic-reviewer.js";
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
  page_title: "Core Engine",
  section_position: "Page 2 of 5",
  current_page_plan: "Explain the core engine architecture and pipeline flow",
  full_book_summary: "A wiki covering setup, core engine, CLI, and web UI",
  draft_file: "/tmp/repo/.reporead/drafts/core-engine.md",
  covered_files: ["src/engine.ts", "src/pipeline.ts"],
  review_questions: ["Does the page stay within scope?"],
};

describe("L1SemanticReviewer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns pass verdict for clean draft", async () => {
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

    const reviewer = new L1SemanticReviewer({ model: {} as never });
    const result = await reviewer.review(briefing, "# Core Engine\n\nSome content with [cite:file:src/engine.ts:1-10].");

    expect(result.success).toBe(true);
    expect(result.conclusion!.verdict).toBe("pass");
    expect(result.metrics!.llmCalls).toBe(1);
  });

  it("returns revise when blockers present", async () => {
    const { generateText } = await import("ai");
    vi.mocked(generateText).mockResolvedValueOnce({
      text: JSON.stringify({
        verdict: "revise",
        blockers: ["Section '## Data Flow' has no citations"],
        factual_risks: [],
        missing_evidence: ["Data Flow section needs file references"],
        scope_violations: [],
        suggested_revisions: ["Add citations to Data Flow section"],
      }),
      usage: { inputTokens: 300, outputTokens: 100 },
    } as never);

    const reviewer = new L1SemanticReviewer({ model: {} as never });
    const result = await reviewer.review(briefing, "# Core Engine\n\n## Data Flow\nNo citations here.");

    expect(result.success).toBe(true);
    expect(result.conclusion!.verdict).toBe("revise");
    expect(result.conclusion!.blockers).toHaveLength(1);
  });

  it("promotes blockers to revise even if model says pass", async () => {
    const { generateText } = await import("ai");
    vi.mocked(generateText).mockResolvedValueOnce({
      text: JSON.stringify({
        verdict: "pass",
        blockers: ["Scope violation: discusses deployment"],
        factual_risks: [],
        missing_evidence: [],
        scope_violations: [],
        suggested_revisions: [],
      }),
      usage: { inputTokens: 300, outputTokens: 80 },
    } as never);

    const reviewer = new L1SemanticReviewer({ model: {} as never });
    const result = await reviewer.review(briefing, "# Core Engine\n\nContent about deployment...");

    expect(result.conclusion!.verdict).toBe("revise");
  });

  it("passes tools={} with maxSteps=1 (no tool calls)", async () => {
    const { generateText } = await import("ai");
    const spy = vi.mocked(generateText);
    spy.mockResolvedValueOnce({
      text: JSON.stringify({ verdict: "pass", blockers: [], factual_risks: [], missing_evidence: [], scope_violations: [], suggested_revisions: [] }),
      usage: { inputTokens: 200, outputTokens: 50 },
    } as never);

    const reviewer = new L1SemanticReviewer({ model: {} as never });
    await reviewer.review(briefing, "# Content");

    const call = spy.mock.calls[0][0] as Record<string, unknown>;
    expect(call.tools).toEqual({});
  });

  it("handles LLM failure gracefully", async () => {
    const { generateText } = await import("ai");
    vi.mocked(generateText).mockRejectedValueOnce(new Error("API error"));

    const reviewer = new L1SemanticReviewer({ model: {} as never });
    const result = await reviewer.review(briefing, "# Content");

    expect(result.success).toBe(false);
    expect(result.error).toContain("L1 review failed");
  });

  it("handles unparseable output as pass", async () => {
    const { generateText } = await import("ai");
    vi.mocked(generateText).mockResolvedValueOnce({
      text: "Looks good to me!",
      usage: { inputTokens: 200, outputTokens: 30 },
    } as never);

    const reviewer = new L1SemanticReviewer({ model: {} as never });
    const result = await reviewer.review(briefing, "# Content");

    expect(result.success).toBe(true);
    expect(result.conclusion!.verdict).toBe("pass");
  });

  it("strictness=strict changes system prompt", async () => {
    const { generateText } = await import("ai");
    const spy = vi.mocked(generateText);
    spy.mockResolvedValueOnce({
      text: JSON.stringify({ verdict: "pass", blockers: [], factual_risks: [], missing_evidence: [], scope_violations: [], suggested_revisions: [] }),
      usage: { inputTokens: 200, outputTokens: 50 },
    } as never);

    const reviewer = new L1SemanticReviewer({ model: {} as never, strictness: "strict" });
    await reviewer.review(briefing, "# Content");

    const call = spy.mock.calls[0][0] as { system?: string };
    expect(call.system).toContain("zero scope violations");
  });
});
