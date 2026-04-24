import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  PageDrafter,
  stripDraftOutputWrappers,
  detectMetaCommentary,
  extractMetadataFromMarkdown,
  revisionStepBudget,
} from "../page-drafter.js";
import type { MainAuthorContext } from "../../types/agent.js";

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

const mockContext: MainAuthorContext = {
  project_summary: "Test project",
  full_book_summary: "Overview and core",
  published_page_summaries: [],
  evidence_ledger: [],
};

const draftMarkdown = `# Core Engine

The core engine handles pipeline orchestration.

[cite:file:src/engine.ts:1-50]

\`\`\`json
{
  "summary": "Explains the core engine architecture",
  "citations": [
    { "kind": "file", "target": "src/engine.ts", "locator": "1-50", "note": "Engine class" }
  ],
  "related_pages": ["setup"]
}
\`\`\``;

describe("PageDrafter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns page markdown and parsed metadata", async () => {
    const { generateText } = await import("ai");
    vi.mocked(generateText).mockResolvedValueOnce({
      text: draftMarkdown,
      usage: { inputTokens: 500, outputTokens: 300 },
    } as never);

    const drafter = new PageDrafter({
      model: {} as never,
      repoRoot: "/tmp/repo",
    });

    const result = await drafter.draft(mockContext, {
      slug: "core-engine",
      title: "Core Engine",
      order: 1,
      coveredFiles: ["src/engine.ts"],
      language: "en",
    });

    expect(result.success).toBe(true);
    expect(result.markdown).toContain("# Core Engine");
    // Metadata is now extracted deterministically from the markdown
    expect(result.metadata!.citations).toHaveLength(1);
    expect(result.metadata!.citations[0].target).toBe("src/engine.ts");
    expect(result.metadata!.citations[0].locator).toBe("1-50");
  });

  it("gracefully handles LLM output with no JSON block", async () => {
    const { generateText } = await import("ai");
    vi.mocked(generateText).mockResolvedValueOnce({
      text: "# Page\n\nSome content with no metadata block.",
      usage: { inputTokens: 100, outputTokens: 50 },
    } as never);

    const drafter = new PageDrafter({
      model: {} as never,
      repoRoot: "/tmp/repo",
    });

    const result = await drafter.draft(mockContext, {
      slug: "bad",
      title: "Bad",
      order: 1,
      coveredFiles: [],
      language: "en",
    });

    // Should succeed with fallback metadata
    expect(result.success).toBe(true);
    expect(result.markdown).toContain("# Page");
    expect(result.metadata!.citations).toEqual([]);
  });

  it("strips JSON metadata block from page markdown", async () => {
    const { generateText } = await import("ai");
    vi.mocked(generateText).mockResolvedValueOnce({
      text: draftMarkdown,
      usage: { inputTokens: 500, outputTokens: 300 },
    } as never);

    const drafter = new PageDrafter({
      model: {} as never,
      repoRoot: "/tmp/repo",
    });

    const result = await drafter.draft(mockContext, {
      slug: "core-engine",
      title: "Core Engine",
      order: 1,
      coveredFiles: ["src/engine.ts"],
      language: "en",
    });

    expect(result.markdown).not.toContain('"summary"');
    expect(result.markdown).not.toContain('"citations"');
  });

  it("strips LLM preamble before the first heading", async () => {
    const pollutedOutput = `Now I have all the necessary information to write a comprehensive wiki page. Let me create the complete page.

${draftMarkdown}`;
    const { generateText } = await import("ai");
    vi.mocked(generateText).mockResolvedValueOnce({
      text: pollutedOutput,
      usage: { inputTokens: 500, outputTokens: 300 },
    } as never);

    const drafter = new PageDrafter({
      model: {} as never,
      repoRoot: "/tmp/repo",
    });

    const result = await drafter.draft(mockContext, {
      slug: "core-engine",
      title: "Core Engine",
      order: 1,
      coveredFiles: ["src/engine.ts"],
      language: "en",
    });

    expect(result.success).toBe(true);
    expect(result.markdown).toMatch(/^# Core Engine/);
    expect(result.markdown).not.toContain("Now I have all the necessary information");
    expect(result.metadata!.citations).toHaveLength(1);
  });

  it("strips outer ```markdown fence wrapping the page", async () => {
    const wrapped = `\`\`\`markdown
# Core Engine

The core engine handles pipeline orchestration.

[cite:file:src/engine.ts:1-50]
\`\`\`

\`\`\`json
{
  "summary": "Explains the core engine architecture",
  "citations": [
    { "kind": "file", "target": "src/engine.ts", "locator": "1-50", "note": "Engine class" }
  ],
  "related_pages": []
}
\`\`\``;
    const { generateText } = await import("ai");
    vi.mocked(generateText).mockResolvedValueOnce({
      text: wrapped,
      usage: { inputTokens: 500, outputTokens: 300 },
    } as never);

    const drafter = new PageDrafter({
      model: {} as never,
      repoRoot: "/tmp/repo",
    });

    const result = await drafter.draft(mockContext, {
      slug: "core-engine",
      title: "Core Engine",
      order: 1,
      coveredFiles: ["src/engine.ts"],
      language: "en",
    });

    expect(result.success).toBe(true);
    expect(result.markdown).toMatch(/^# Core Engine/);
    expect(result.markdown).not.toContain("```markdown");
    // The inner [cite:...] marker should survive
    expect(result.markdown).toContain("[cite:file:src/engine.ts:1-50]");
    // Metadata is now extracted deterministically from the markdown
    expect(result.metadata!.citations).toHaveLength(1);
    // Summary is the first prose paragraph, not from the (stripped) JSON block
    expect(result.metadata!.summary).toContain("core engine");
  });

  it("strips preamble AND outer markdown fence together", async () => {
    const polluted = `Now I have all the necessary information to write a comprehensive wiki page about the core engine. Let me create the complete page.

\`\`\`markdown
# Core Engine

The core engine handles pipeline orchestration.

[cite:file:src/engine.ts:1-50]
\`\`\`

\`\`\`json
{
  "summary": "Explains the core engine",
  "citations": [
    { "kind": "file", "target": "src/engine.ts", "locator": "1-50" }
  ],
  "related_pages": []
}
\`\`\``;
    const { generateText } = await import("ai");
    vi.mocked(generateText).mockResolvedValueOnce({
      text: polluted,
      usage: { inputTokens: 500, outputTokens: 300 },
    } as never);

    const drafter = new PageDrafter({
      model: {} as never,
      repoRoot: "/tmp/repo",
    });

    const result = await drafter.draft(mockContext, {
      slug: "core-engine",
      title: "Core Engine",
      order: 1,
      coveredFiles: ["src/engine.ts"],
      language: "en",
    });

    expect(result.markdown).toMatch(/^# Core Engine/);
    expect(result.markdown).not.toContain("Now I have");
    expect(result.markdown).not.toContain("```markdown");
    expect(result.metadata!.citations).toHaveLength(1);
  });

  it("preserves inner code fences inside the page body", async () => {
    // Inner ```typescript or ```python blocks must NOT be mistaken for the
    // outer ```markdown wrapper.
    const withInnerFence = `# Core Engine

Here's how the engine starts:

\`\`\`typescript
function start() {
  return new Engine();
}
\`\`\`

And a bash snippet:

\`\`\`bash
npm run start
\`\`\`

[cite:file:src/engine.ts:1-10]

\`\`\`json
{
  "summary": "Engine startup",
  "citations": [{ "kind": "file", "target": "src/engine.ts", "locator": "1-10" }],
  "related_pages": []
}
\`\`\``;
    const { generateText } = await import("ai");
    vi.mocked(generateText).mockResolvedValueOnce({
      text: withInnerFence,
      usage: { inputTokens: 500, outputTokens: 300 },
    } as never);

    const drafter = new PageDrafter({
      model: {} as never,
      repoRoot: "/tmp/repo",
    });

    const result = await drafter.draft(mockContext, {
      slug: "core-engine",
      title: "Core Engine",
      order: 1,
      coveredFiles: ["src/engine.ts"],
      language: "en",
    });

    expect(result.markdown).toContain("```typescript");
    expect(result.markdown).toContain("```bash");
    expect(result.markdown).toContain("function start()");
    expect(result.markdown).toContain("npm run start");
  });

  it("marks result as truncated when finishReason is length", async () => {
    const { generateText } = await import("ai");
    vi.mocked(generateText).mockResolvedValueOnce({
      text: "# Core Engine\n\nThe core engine",
      usage: { inputTokens: 500, outputTokens: 16384 },
      finishReason: "length",
    } as never);

    const drafter = new PageDrafter({
      model: {} as never,
      repoRoot: "/tmp/repo",
    });

    const result = await drafter.draft(mockContext, {
      slug: "core-engine",
      title: "Core Engine",
      order: 1,
      coveredFiles: ["src/engine.ts"],
      language: "en",
    });

    expect(result.success).toBe(true);
    expect(result.truncated).toBe(true);
  });

  it("returns success=false with diagnostic error when LLM output is empty", async () => {
    // Observed in trpc-go run: kingxliu provider returned HTTP 200 with
    // model="" and content="" after several tool-calling rounds. Without this
    // guard the drafter silently returned {success:true, markdown:""} and the
    // pipeline failed the page with a generic message.
    const { generateText } = await import("ai");
    vi.mocked(generateText).mockResolvedValueOnce({
      text: "",
      usage: { inputTokens: 30000, outputTokens: 0 },
      finishReason: "stop",
    } as never);

    const drafter = new PageDrafter({
      model: {} as never,
      repoRoot: "/tmp/repo",
    });

    const result = await drafter.draft(mockContext, {
      slug: "core-engine",
      title: "Core Engine",
      order: 1,
      coveredFiles: ["src/engine.ts"],
      language: "en",
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/empty output/i);
    expect(result.error).toMatch(/finishReason=stop/);
    expect(result.error).toMatch(/rawTextLength=0/);
    // Metrics still captured so throughput accounts for the failed call
    expect(result.metrics?.llmCalls).toBe(1);
    expect(result.metrics?.usage.inputTokens).toBe(30000);
  });

  it("returns success=false when LLM output is only whitespace", async () => {
    const { generateText } = await import("ai");
    vi.mocked(generateText).mockResolvedValueOnce({
      text: "   \n\n  \t  \n",
      usage: { inputTokens: 500, outputTokens: 3 },
      finishReason: "stop",
    } as never);

    const drafter = new PageDrafter({
      model: {} as never,
      repoRoot: "/tmp/repo",
    });

    const result = await drafter.draft(mockContext, {
      slug: "core-engine",
      title: "Core Engine",
      order: 1,
      coveredFiles: [],
      language: "en",
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/empty output/i);
  });

  it("does not mark as truncated when finishReason is stop", async () => {
    const { generateText } = await import("ai");
    vi.mocked(generateText).mockResolvedValueOnce({
      text: draftMarkdown,
      usage: { inputTokens: 500, outputTokens: 300 },
      finishReason: "stop",
    } as never);

    const drafter = new PageDrafter({
      model: {} as never,
      repoRoot: "/tmp/repo",
    });

    const result = await drafter.draft(mockContext, {
      slug: "core-engine",
      title: "Core Engine",
      order: 1,
      coveredFiles: ["src/engine.ts"],
      language: "en",
    });

    expect(result.truncated).toBeUndefined();
  });


});

describe("revisionStepBudget", () => {
  it("returns the full budget for the initial draft", () => {
    expect(revisionStepBudget(100, 0)).toBe(100);
    expect(revisionStepBudget(20, 0)).toBe(20);
  });

  it("shrinks to 60% on the first revision", () => {
    expect(revisionStepBudget(100, 1)).toBe(60);
    expect(revisionStepBudget(20, 1)).toBe(12);
  });

  it("shrinks to 40% from the second revision onward", () => {
    expect(revisionStepBudget(100, 2)).toBe(40);
    expect(revisionStepBudget(100, 3)).toBe(40);
    expect(revisionStepBudget(100, 10)).toBe(40);
  });

  it("floors at 4 steps so tiny budgets still complete", () => {
    // budget preset has drafterMaxSteps=12 → 0.4 × 12 = 4.8 → 4
    expect(revisionStepBudget(12, 2)).toBe(4);
    // Artificially small budget still respects the floor
    expect(revisionStepBudget(5, 2)).toBe(4);
  });
});

describe("PageDrafter per-call maxSteps override", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("accepts an overrides.maxSteps argument without breaking the draft flow", async () => {
    const { generateText } = await import("ai");
    vi.mocked(generateText).mockResolvedValueOnce({
      text: draftMarkdown,
      usage: { inputTokens: 100, outputTokens: 100 },
    } as never);

    const drafter = new PageDrafter({
      model: {} as never,
      repoRoot: "/tmp/repo",
      maxSteps: 100,
    });

    const result = await drafter.draft(
      mockContext,
      {
        slug: "core-engine",
        title: "Core Engine",
        order: 1,
        coveredFiles: ["src/engine.ts"],
        language: "en",
      },
      { maxSteps: 40 },
    );

    expect(result.success).toBe(true);
    expect(result.markdown).toContain("# Core Engine");
  });
});

describe("stripDraftOutputWrappers", () => {
  it("returns text unchanged when it starts with a heading", () => {
    const input = "# Title\n\nContent.";
    expect(stripDraftOutputWrappers(input)).toBe("# Title\n\nContent.");
  });

  it("strips a leading preamble sentence", () => {
    const input =
      "Now I have all the necessary information. Let me write.\n\n# Title\n\nContent.";
    expect(stripDraftOutputWrappers(input)).toBe("# Title\n\nContent.");
  });

  it("strips an outer markdown fence with no json block", () => {
    const input = "```markdown\n# Title\n\nContent.\n```";
    const out = stripDraftOutputWrappers(input);
    expect(out).toMatch(/^# Title/);
    expect(out).not.toContain("```markdown");
  });

  it("strips outer markdown fence but keeps trailing json block", () => {
    const input =
      '```markdown\n# Title\n\nContent.\n```\n\n```json\n{"summary":"x"}\n```';
    const out = stripDraftOutputWrappers(input);
    expect(out).toMatch(/^# Title/);
    expect(out).not.toContain("```markdown");
    expect(out).toContain("```json");
    expect(out).toContain('{"summary":"x"}');
  });

  it("preserves inner code fences when stripping outer markdown fence", () => {
    const input =
      "```markdown\n# Title\n\n```python\nprint('hi')\n```\n\nMore text.\n```";
    const out = stripDraftOutputWrappers(input);
    expect(out).toContain("```python");
    expect(out).toContain("print('hi')");
    // Inner fence opener should still be there
    expect(out.match(/```python/g)).toHaveLength(1);
  });
});

describe("detectMetaCommentary", () => {
  it("returns null for a clean page with no meta phrases", () => {
    const md = `# Title\n\nThis is the real opening paragraph of the page. It explains the topic directly.\n\n## Section One\n\nHere is substantive technical content about how the module works. See [cite:file:a.ts:1-10] for the entry point. The function initializes three subsystems.\n\n## Section Two\n\nMore substantive prose about the second aspect of the system, with specific technical detail and references.`;
    expect(detectMetaCommentary(md)).toBeNull();
  });

  it("returns null when a single casual phrase appears inside normal prose", () => {
    // Isolated appearances like "Let me know if..." in a reader-facing
    // aside shouldn't trip the guard — only multi-paragraph meta runs.
    const md = `# Title\n\nThis page covers three patterns that recur throughout the codebase. Let me walk through them one by one.\n\n## First pattern\n\nThe adapter layer translates between protocol and internal representation [cite:file:adapter.go:1-20].`;
    expect(detectMetaCommentary(md)).toBeNull();
  });

  it("flags the CubeSandbox Cubelet failure pattern (LLM thinking leaked as body)", () => {
    // Actual observed output from CubeSandbox page 7 third attempt — LLM
    // returned its internal planning stream instead of markdown. Before
    // the guard this page published with ~35 meta phrases and reviewer
    // couldn't catch it.
    const md = `# Cubelet：节点守护进程
\`\`\`

Then the summary paragraph.

Then the sections.

OK, I'm confident. Let me write.

Actually, I realize I should also check the config/config.toml file.

Let me read the config.toml now.

From evidence entry 17: \`Cubelet/config/config.toml:1-176\` - TOML config file example.

Actually, I have enough context. Let me just write the page.

OK, writing now. For real this time.

Let me also think about how to handle the mount namespace rationale.

The reviewer said this makes a specific behavior claim without citation. I should either:
1. Cite the code
2. Hedge it as inference

Let me write: [some draft here]

This is verifiable from the code.

OK, writing now.
`;
    const result = detectMetaCommentary(md);
    expect(result).not.toBeNull();
    expect(result!.matchedPhrases).toBeGreaterThanOrEqual(5);
    expect(result!.totalParagraphs).toBeGreaterThan(3);
    // At least half the text should have been flagged.
    expect(result!.matchedRatio).toBeGreaterThanOrEqual(0.4);
  });

  it("flags body with many meta-phrase openers even if interleaved with real sentences", () => {
    const md = `# Title

Let me think about this page.

Here is one real sentence with technical content [cite:file:x.go:1-10].

Actually, I realize the structure should be different.

OK, let me write the first section now.

Another real sentence with concrete detail.

Wait, I should double-check the evidence first.

Hmm, I need to cite this more carefully.

Let me also check the imports.`;
    const result = detectMetaCommentary(md);
    expect(result).not.toBeNull();
    expect(result!.matchedPhrases).toBeGreaterThanOrEqual(5);
  });

  it("does not flag legitimate imperative prose starting with 'Let's' or 'Note that'", () => {
    // A good technical writer does use "Let's look at the trade-offs" —
    // one or two such phrases shouldn't flag the page. Threshold is
    // about DENSITY, not any single occurrence.
    const md = `# Architecture

This page introduces the core architecture of the system. Let's start with the call graph.

## Request lifecycle

A request enters through the gateway [cite:file:gateway.go:100-200] and is dispatched to one of three handlers. Note that the dispatch is deterministic — the same request always routes to the same handler.

## Storage layer

The storage layer persists state to disk. It supports three formats: JSON for configuration, SQLite for logs, and flat files for raw dumps [cite:file:storage.go:50-100].`;
    expect(detectMetaCommentary(md)).toBeNull();
  });
});

describe("extractMetadataFromMarkdown", () => {
  it("extracts summary from first paragraph after title", () => {
    const md = `# My Page\n\nThis is the summary paragraph.\n\n## Section\n\nMore text.`;
    const meta = extractMetadataFromMarkdown(md);
    expect(meta.summary).toBe("This is the summary paragraph.");
  });

  it("extracts deduplicated citations", () => {
    const md = `# Page\n\nText [cite:file:src/a.ts:10-20] and [cite:file:src/b.ts:30-40].\n\nAlso [cite:file:src/a.ts:10-20] again.\n\nAnd [cite:commit:abc1234].`;
    const meta = extractMetadataFromMarkdown(md);
    expect(meta.citations).toHaveLength(3);
    expect(meta.citations[0]).toEqual({ kind: "file", target: "src/a.ts", locator: "10-20" });
    expect(meta.citations[1]).toEqual({ kind: "file", target: "src/b.ts", locator: "30-40" });
    expect(meta.citations[2]).toEqual({ kind: "commit", target: "abc1234", locator: undefined });
  });

  it("extracts related_pages from page citations", () => {
    const md = `# Page\n\nSee [cite:page:setup] and [cite:page:overview] for details.\n\nAlso [cite:file:src/x.ts:1-5].`;
    const meta = extractMetadataFromMarkdown(md);
    expect(meta.related_pages).toEqual(["setup", "overview"]);
  });

  it("handles markdown with no citations", () => {
    const md = `# Empty Page\n\nNo citations here.`;
    const meta = extractMetadataFromMarkdown(md);
    expect(meta.citations).toEqual([]);
    expect(meta.related_pages).toEqual([]);
    expect(meta.summary).toBe("No citations here.");
  });

  it("skips headings, lists, and code fences when finding summary", () => {
    const md = `# Title\n\n## First Section\n\n- A list item\n\n\`\`\`ts\ncode()\n\`\`\`\n\nActual summary text.`;
    const meta = extractMetadataFromMarkdown(md);
    expect(meta.summary).toBe("Actual summary text.");
  });
});
