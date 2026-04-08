import { describe, it, expect, vi } from "vitest";
import { CatalogPlanner } from "../catalog-planner.js";
import type { RepoProfile } from "../../types/project.js";
import type { WikiJson } from "../../types/generation.js";

// Mock the AI SDK
vi.mock("ai", () => ({
  generateText: vi.fn(),
  tool: vi.fn((def: unknown) => def),
}));

const mockProfile: RepoProfile = {
  projectSlug: "test",
  repoRoot: "/tmp/repo",
  repoName: "test",
  branch: "main",
  commitHash: "abc",
  languages: ["TypeScript"],
  frameworks: [],
  packageManagers: ["npm"],
  entryFiles: ["src/index.ts"],
  importantDirs: ["src"],
  ignoredPaths: [],
  sourceFileCount: 10,
  docFileCount: 2,
  treeSummary: "src/\n  index.ts",
  architectureHints: [],
};

const validWikiJson: WikiJson = {
  summary: "A test project",
  reading_order: [
    { slug: "overview", title: "Project Overview", rationale: "Understand what the project does", covered_files: ["src/index.ts", "README.md"] },
    { slug: "core-module", title: "Core Module", rationale: "Deep dive into the main module", covered_files: ["src/index.ts"] },
  ],
};

describe("CatalogPlanner", () => {
  it("returns parsed WikiJson from LLM output", async () => {
    const { generateText } = await import("ai");
    const mockGenerateText = vi.mocked(generateText);
    mockGenerateText.mockResolvedValueOnce({
      text: JSON.stringify(validWikiJson),
      toolCalls: [],
      toolResults: [],
      finishReason: "stop",
      usage: { promptTokens: 100, completionTokens: 200, totalTokens: 300 },
    } as never);

    const planner = new CatalogPlanner({ model: {} as never, language: "en" });
    const result = await planner.plan(mockProfile);
    expect(result.success).toBe(true);
    expect(result.wiki!.summary).toBe("A test project");
    expect(result.wiki!.reading_order).toHaveLength(2);
    expect(result.wiki!.reading_order[0].slug).toBe("overview");
  });

  it("returns error when LLM output is invalid JSON", async () => {
    const { generateText } = await import("ai");
    const mockGenerateText = vi.mocked(generateText);
    mockGenerateText.mockResolvedValueOnce({
      text: "This is not JSON",
      toolCalls: [],
      toolResults: [],
      finishReason: "stop",
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    } as never);

    const planner = new CatalogPlanner({ model: {} as never, language: "en" });
    const result = await planner.plan(mockProfile);
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});
