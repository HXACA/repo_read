import { describe, it, expect, vi, beforeEach } from "vitest";
import { ResearchPlanner } from "../research-planner.js";

vi.mock("ai", () => ({
  generateText: vi.fn(),
  jsonSchema: vi.fn((s: unknown) => s),
}));

describe("ResearchPlanner", () => {
  beforeEach(() => vi.clearAllMocks());

  it("parses plan with sub-questions", async () => {
    const { generateText } = await import("ai");
    vi.mocked(generateText).mockResolvedValueOnce({
      text: JSON.stringify({
        topic: "Error handling",
        subQuestions: ["How are errors caught?", "What retry logic exists?"],
        scope: "Error handling across the pipeline",
      }),
      usage: { inputTokens: 200, outputTokens: 100 },
    } as never);

    const planner = new ResearchPlanner({ model: {} as never, repoRoot: "/tmp" });
    const plan = await planner.plan("Error handling");

    expect(plan.topic).toBe("Error handling");
    expect(plan.subQuestions).toHaveLength(2);
    expect(plan.scope).toContain("Error");
  });

  it("falls back on invalid JSON", async () => {
    const { generateText } = await import("ai");
    vi.mocked(generateText).mockResolvedValueOnce({
      text: "Not valid JSON",
      usage: { inputTokens: 100, outputTokens: 50 },
    } as never);

    const planner = new ResearchPlanner({ model: {} as never, repoRoot: "/tmp" });
    const plan = await planner.plan("Some topic");

    expect(plan.topic).toBe("Some topic");
    expect(plan.subQuestions).toEqual(["Some topic"]);
  });
});
