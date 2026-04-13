import { describe, it, expect, vi } from "vitest";
import { EvidencePlanner, fallbackPlan } from "../evidence-planner.js";
import type { EvidencePlanInput } from "../evidence-planner.js";

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

const baseInput: EvidencePlanInput = {
  pageTitle: "System Architecture",
  pageRationale: "High-level view of the system",
  coveredFiles: ["api/api.py", "api/models.py", "api/rag.py", "api/config.py"],
  pageOrder: 2,
  publishedSummaries: [],
  taskCount: 3,
  language: "zh",
};

describe("EvidencePlanner", () => {
  it("fast-paths single-worker plans without calling the LLM", async () => {
    const { generateText } = await import("ai");
    const mock = vi.mocked(generateText);
    mock.mockClear();

    const planner = new EvidencePlanner({ model: {} as never });
    const result = await planner.plan({ ...baseInput, taskCount: 1 });

    expect(result.success).toBe(true);
    expect(mock).not.toHaveBeenCalled();
    if (result.success) {
      expect(result.plan.tasks).toHaveLength(1);
      expect(result.plan.tasks[0].targetFiles).toEqual(baseInput.coveredFiles);
    }
  });

  it("parses a valid LLM response into a plan", async () => {
    const { generateText } = await import("ai");
    const mock = vi.mocked(generateText);
    mock.mockResolvedValueOnce({
      text: JSON.stringify({
        tasks: [
          {
            id: "t1",
            directive: "查找 FastAPI 路由",
            targetFiles: ["api/api.py"],
            rationale: "主路由文件",
          },
          {
            id: "t2",
            directive: "收集 Pydantic 模型",
            targetFiles: ["api/models.py"],
            rationale: "数据模型",
          },
          {
            id: "t3",
            directive: "分析 RAG 与配置",
            targetFiles: ["api/rag.py", "api/config.py"],
            rationale: "核心逻辑与配置",
          },
        ],
      }),
    } as never);

    const planner = new EvidencePlanner({ model: {} as never });
    const result = await planner.plan(baseInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.plan.tasks).toHaveLength(3);
      const allFiles = new Set(result.plan.tasks.flatMap((t) => t.targetFiles));
      for (const f of baseInput.coveredFiles) {
        expect(allFiles.has(f)).toBe(true);
      }
    }
  });

  it("reports failure when the LLM output is not valid JSON", async () => {
    const { generateText } = await import("ai");
    const mock = vi.mocked(generateText);
    mock.mockResolvedValueOnce({
      text: "this is not JSON at all",
    } as never);

    const planner = new EvidencePlanner({ model: {} as never });
    const result = await planner.plan(baseInput);

    expect(result.success).toBe(false);
  });

  it("reports failure when a covered file is not assigned", async () => {
    const { generateText } = await import("ai");
    const mock = vi.mocked(generateText);
    mock.mockResolvedValueOnce({
      text: JSON.stringify({
        tasks: [
          { id: "t1", directive: "d1", targetFiles: ["api/api.py"], rationale: "r1" },
          { id: "t2", directive: "d2", targetFiles: ["api/models.py"], rationale: "r2" },
          // api/rag.py and api/config.py are missing!
          { id: "t3", directive: "d3", targetFiles: ["api/api.py"], rationale: "r3" },
        ],
      }),
    } as never);

    const planner = new EvidencePlanner({ model: {} as never });
    const result = await planner.plan(baseInput);

    expect(result.success).toBe(false);
  });

  it("reports failure when the LLM returns the wrong task count", async () => {
    const { generateText } = await import("ai");
    const mock = vi.mocked(generateText);
    mock.mockResolvedValueOnce({
      text: JSON.stringify({
        tasks: [
          {
            id: "t1",
            directive: "d1",
            targetFiles: baseInput.coveredFiles,
            rationale: "r1",
          },
        ],
      }),
    } as never);

    const planner = new EvidencePlanner({ model: {} as never });
    const result = await planner.plan({ ...baseInput, taskCount: 3 });

    expect(result.success).toBe(false);
  });

  it("downgrades task count when coveredFiles is small", async () => {
    const { generateText } = await import("ai");
    const mock = vi.mocked(generateText);
    mock.mockClear();

    const planner = new EvidencePlanner({ model: {} as never });
    const result = await planner.plan({
      ...baseInput,
      coveredFiles: ["api/api.py"],
      taskCount: 3,
    });

    // 1 covered file → fast path (effectiveTaskCount = 1) kicks in, no LLM call
    expect(mock).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.plan.tasks).toHaveLength(1);
    }
  });
});

describe("fallbackPlan", () => {
  it("splits files evenly into N buckets", () => {
    const plan = fallbackPlan({
      ...baseInput,
      coveredFiles: ["a", "b", "c", "d", "e", "f"],
      taskCount: 3,
    });
    expect(plan.tasks).toHaveLength(3);
    expect(plan.tasks[0].targetFiles).toEqual(["a", "b"]);
    expect(plan.tasks[1].targetFiles).toEqual(["c", "d"]);
    expect(plan.tasks[2].targetFiles).toEqual(["e", "f"]);
  });

  it("handles uneven splits", () => {
    const plan = fallbackPlan({
      ...baseInput,
      coveredFiles: ["a", "b", "c", "d", "e"],
      taskCount: 3,
    });
    // perBucket = ceil(5/3) = 2 → [a,b], [c,d], [e], (empty 4th skipped)
    expect(plan.tasks).toHaveLength(3);
    expect(plan.tasks[0].targetFiles).toEqual(["a", "b"]);
    expect(plan.tasks[1].targetFiles).toEqual(["c", "d"]);
    expect(plan.tasks[2].targetFiles).toEqual(["e"]);
  });

  it("downgrades to file count when taskCount > files", () => {
    const plan = fallbackPlan({
      ...baseInput,
      coveredFiles: ["a", "b"],
      taskCount: 5,
    });
    expect(plan.tasks.length).toBeLessThanOrEqual(2);
    expect(plan.tasks.flatMap((t) => t.targetFiles).sort()).toEqual(["a", "b"]);
  });
});
