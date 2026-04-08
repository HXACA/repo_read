import { describe, it, expect, vi, beforeEach } from "vitest";
import { PageDrafter } from "../page-drafter.js";
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
});
