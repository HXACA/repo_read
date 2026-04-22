import { describe, it, expect, vi } from "vitest";
import { CatalogPlanner } from "../catalog-planner.js";
import type { RepoProfile } from "../../types/project.js";
import type { WikiJson } from "../../types/generation.js";

// Mock the AI SDK
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
    tool: vi.fn((def: unknown) => def),
    jsonSchema: vi.fn((schema: unknown) => schema),
    stepCountIs: vi.fn(() => () => false),
  };
});

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

  it("fires onAttemptFailed for each failed attempt so pipeline can emit observable events", async () => {
    const { generateText } = await import("ai");
    const mockGenerateText = vi.mocked(generateText);
    // All 3 attempts return unparseable text → all should fail and onAttemptFailed
    // must be called once per attempt with the correct attempt index.
    for (let i = 0; i < 3; i++) {
      mockGenerateText.mockResolvedValueOnce({
        text: `attempt ${i + 1} garbage`,
        toolCalls: [], toolResults: [], finishReason: "stop",
        usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
      } as never);
    }
    const fails: Array<{ attempt: number; maxRetries: number; error: string }> = [];
    const planner = new CatalogPlanner({
      model: {} as never,
      language: "en",
      onAttemptFailed: (attempt, maxRetries, error) => {
        fails.push({ attempt, maxRetries, error });
      },
    });
    const result = await planner.plan(mockProfile);
    expect(result.success).toBe(false);
    expect(fails).toHaveLength(3);
    expect(fails[0].attempt).toBe(1);
    expect(fails[0].maxRetries).toBe(3);
    expect(fails[1].attempt).toBe(2);
    expect(fails[2].attempt).toBe(3);
    // All should carry a non-empty error string
    for (const f of fails) {
      expect(f.error).toMatch(/./);
    }
  });

  it("does not fire onAttemptFailed on a successful first attempt", async () => {
    const { generateText } = await import("ai");
    const mockGenerateText = vi.mocked(generateText);
    mockGenerateText.mockResolvedValueOnce({
      text: JSON.stringify(validWikiJson),
      toolCalls: [], toolResults: [], finishReason: "stop",
      usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
    } as never);
    const fails: unknown[] = [];
    const planner = new CatalogPlanner({
      model: {} as never,
      language: "en",
      onAttemptFailed: (...args) => fails.push(args),
    });
    const result = await planner.plan(mockProfile);
    expect(result.success).toBe(true);
    expect(fails).toHaveLength(0);
  });

  it("fires onAttemptFailed then succeeds when a mid-attempt recovers", async () => {
    const { generateText } = await import("ai");
    const mockGenerateText = vi.mocked(generateText);
    // First attempt fails, second succeeds.
    mockGenerateText.mockResolvedValueOnce({
      text: "garbage", toolCalls: [], toolResults: [], finishReason: "stop",
      usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
    } as never);
    mockGenerateText.mockResolvedValueOnce({
      text: JSON.stringify(validWikiJson), toolCalls: [], toolResults: [], finishReason: "stop",
      usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
    } as never);
    const fails: number[] = [];
    const planner = new CatalogPlanner({
      model: {} as never,
      language: "en",
      onAttemptFailed: (attempt) => fails.push(attempt),
    });
    const result = await planner.plan(mockProfile);
    expect(result.success).toBe(true);
    expect(fails).toEqual([1]); // only the first attempt failed
  });
});
