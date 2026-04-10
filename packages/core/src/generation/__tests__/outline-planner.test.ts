import { describe, it, expect, vi, beforeEach } from "vitest";
import { OutlinePlanner } from "../outline-planner.js";
import type { OutlinePlannerInput } from "../outline-planner.js";

vi.mock("ai", () => ({
  generateText: vi.fn(),
  jsonSchema: vi.fn((s: unknown) => s),
  stepCountIs: vi.fn(() => () => false),
}));

const baseInput: OutlinePlannerInput = {
  pageTitle: "系统架构",
  pageRationale: "展示整体架构设计",
  coveredFiles: ["api/main.py", "api/api.py"],
  language: "zh",
  ledger: [
    { id: "1", kind: "file", target: "api/main.py", note: "FastAPI entry" },
    { id: "2", kind: "file", target: "api/api.py", note: "Route definitions" },
    { id: "3", kind: "file", target: "api/rag.py", note: "RAG implementation" },
  ],
  findings: ["FastAPI runs on port 8001", "CORS allows all origins"],
};

const goodOutline = JSON.stringify({
  sections: [
    {
      heading: "概述",
      key_points: ["项目定位", "技术栈"],
      cite_from: [{ target: "api/main.py", locator: "1-20" }],
    },
    {
      heading: "后端架构",
      key_points: ["FastAPI 入口", "路由设计"],
      cite_from: [
        { target: "api/main.py", locator: "60-78" },
        { target: "api/api.py", locator: "20-40" },
      ],
    },
    {
      heading: "RAG 系统",
      key_points: ["向量检索", "对话记忆"],
      cite_from: [{ target: "api/rag.py", locator: "50-80" }],
    },
  ],
});

describe("OutlinePlanner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("parses a valid LLM outline into PageOutline", async () => {
    const { generateText } = await import("ai");
    vi.mocked(generateText).mockResolvedValueOnce({
      text: goodOutline,
      usage: { inputTokens: 200, outputTokens: 150 },
    } as never);

    const planner = new OutlinePlanner({ model: {} as never });
    const result = await planner.plan(baseInput);

    expect(result.sections).toHaveLength(3);
    expect(result.sections[0].heading).toBe("概述");
    expect(result.sections[1].cite_from).toHaveLength(2);
    expect(result.sections[1].cite_from[0].target).toBe("api/main.py");
    expect(result.sections[1].cite_from[0].locator).toBe("60-78");
    expect(result.sections[2].key_points).toContain("向量检索");
  });

  it("falls back to file-grouped outline on LLM failure", async () => {
    const { generateText } = await import("ai");
    vi.mocked(generateText).mockRejectedValueOnce(new Error("API timeout"));

    const planner = new OutlinePlanner({ model: {} as never });
    const result = await planner.plan(baseInput);

    // Fallback: 1 intro section + 1 section per unique file basename
    expect(result.sections.length).toBeGreaterThanOrEqual(2);
    // First section should be overview
    expect(result.sections[0].heading).toBe("概述");
    // File-based sections should reference the ledger entries
    const allTargets = result.sections
      .flatMap((s) => s.cite_from)
      .map((c) => c.target);
    expect(allTargets).toContain("api/main.py");
    expect(allTargets).toContain("api/api.py");
  });

  it("falls back when LLM returns unparseable output", async () => {
    const { generateText } = await import("ai");
    vi.mocked(generateText).mockResolvedValueOnce({
      text: "I cannot generate an outline for this.",
      usage: { inputTokens: 100, outputTokens: 20 },
    } as never);

    const planner = new OutlinePlanner({ model: {} as never });
    const result = await planner.plan(baseInput);

    expect(result.sections.length).toBeGreaterThanOrEqual(2);
    expect(result.sections[0].heading).toBe("概述");
  });

  it("falls back when LLM returns too few sections", async () => {
    const { generateText } = await import("ai");
    vi.mocked(generateText).mockResolvedValueOnce({
      text: JSON.stringify({
        sections: [
          { heading: "Only one", key_points: [], cite_from: [] },
        ],
      }),
      usage: { inputTokens: 100, outputTokens: 50 },
    } as never);

    const planner = new OutlinePlanner({ model: {} as never });
    const result = await planner.plan(baseInput);

    // Should fall back because < 2 sections
    expect(result.sections.length).toBeGreaterThanOrEqual(2);
  });

  it("tolerates missing fields in section entries", async () => {
    const { generateText } = await import("ai");
    vi.mocked(generateText).mockResolvedValueOnce({
      text: JSON.stringify({
        sections: [
          {
            heading: "First",
            key_points: ["a"],
            cite_from: [{ target: "api/main.py" }],
          },
          {
            heading: "Second",
            // missing key_points and cite_from
          },
          {
            // missing heading — should be skipped
            key_points: ["orphan"],
            cite_from: [],
          },
        ],
      }),
      usage: { inputTokens: 100, outputTokens: 80 },
    } as never);

    const planner = new OutlinePlanner({ model: {} as never });
    const result = await planner.plan(baseInput);

    // Two sections survive (First + Second); the headingless one is dropped
    expect(result.sections).toHaveLength(2);
    expect(result.sections[0].cite_from[0].locator).toBeUndefined();
    expect(result.sections[1].key_points).toEqual([]);
    expect(result.sections[1].cite_from).toEqual([]);
  });
});
