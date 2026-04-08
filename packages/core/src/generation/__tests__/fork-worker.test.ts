import { describe, it, expect, vi, beforeEach } from "vitest";
import { ForkWorker } from "../fork-worker.js";

vi.mock("ai", () => ({
  generateText: vi.fn(),
  jsonSchema: vi.fn((s: unknown) => s),
  stepCountIs: vi.fn(() => () => false),
}));

const validOutput = JSON.stringify({
  directive: "Check error handling in src/engine.ts",
  findings: ["Engine constructor throws on null config", "No retry logic in pipeline"],
  citations: [
    { kind: "file", target: "src/engine.ts", locator: "15-22", note: "Constructor validation" },
  ],
  open_questions: ["Is retry handled at a higher level?"],
});

describe("ForkWorker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns structured findings from LLM output", async () => {
    const { generateText } = await import("ai");
    vi.mocked(generateText).mockResolvedValueOnce({
      text: validOutput,
      usage: { inputTokens: 200, outputTokens: 100 },
    } as never);

    const worker = new ForkWorker({
      model: {} as never,
      repoRoot: "/tmp/repo",
    });

    const result = await worker.execute({
      directive: "Check error handling in src/engine.ts",
      context: "Writing page about core engine",
      relevantFiles: ["src/engine.ts"],
    });

    expect(result.success).toBe(true);
    expect(result.data!.directive).toBe("Check error handling in src/engine.ts");
    expect(result.data!.findings).toHaveLength(2);
    expect(result.data!.citations).toHaveLength(1);
    expect(result.data!.open_questions).toHaveLength(1);
  });

  it("returns error on invalid JSON output", async () => {
    const { generateText } = await import("ai");
    vi.mocked(generateText).mockResolvedValueOnce({
      text: "Not JSON at all",
      usage: { inputTokens: 100, outputTokens: 50 },
    } as never);

    const worker = new ForkWorker({
      model: {} as never,
      repoRoot: "/tmp/repo",
    });

    const result = await worker.execute({
      directive: "Check something",
      context: "Some context",
      relevantFiles: [],
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});
