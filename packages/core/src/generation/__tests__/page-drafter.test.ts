import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  PageDrafter,
  stripDraftOutputWrappers,
  extractMetadataFromMarkdown,
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
