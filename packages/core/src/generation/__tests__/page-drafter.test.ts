import { describe, it, expect, vi, beforeEach } from "vitest";
import { PageDrafter, stripDraftOutputWrappers } from "../page-drafter.js";
import type { MainAuthorContext } from "../../types/agent.js";

vi.mock("ai", () => ({
  generateText: vi.fn(),
  jsonSchema: vi.fn((s: unknown) => s),
  stepCountIs: vi.fn(() => () => false),
}));

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
    expect(result.metadata!.summary).toBe("Explains the core engine architecture");
    expect(result.metadata!.citations).toHaveLength(1);
    expect(result.metadata!.citations[0].target).toBe("src/engine.ts");
    expect(result.metadata!.related_pages).toEqual(["setup"]);
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
    // JSON metadata should still parse
    expect(result.metadata!.citations).toHaveLength(1);
    expect(result.metadata!.summary).toBe("Explains the core engine architecture");
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

  it("passes maxOutputTokens to generateText", async () => {
    const { generateText } = await import("ai");
    const spy = vi.mocked(generateText);
    spy.mockResolvedValueOnce({
      text: draftMarkdown,
      usage: { inputTokens: 500, outputTokens: 300 },
      finishReason: "stop",
    } as never);

    const drafter = new PageDrafter({
      model: {} as never,
      repoRoot: "/tmp/repo",
      maxOutputTokens: 20000,
    });

    await drafter.draft(mockContext, {
      slug: "core-engine",
      title: "Core Engine",
      order: 1,
      coveredFiles: ["src/engine.ts"],
      language: "en",
    });

    const call = spy.mock.calls[0][0] as { maxOutputTokens?: number };
    expect(call.maxOutputTokens).toBe(20000);
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
