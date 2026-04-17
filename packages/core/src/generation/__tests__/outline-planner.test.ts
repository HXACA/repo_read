import { describe, it, expect, vi, beforeEach } from "vitest";
import { OutlinePlanner } from "../outline-planner.js";
import type { OutlinePlannerInput } from "../outline-planner.js";
import type { Mechanism } from "../mechanism-list.js";

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

describe("OutlinePlanner mechanism coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("accepts mechanisms and renders them into the prompt", async () => {
    const { generateText } = await import("ai");
    const mockGenerateText = vi.mocked(generateText);

    const validOutline = JSON.stringify({
      sections: [
        { heading: "A", key_points: ["k1"], cite_from: [], covers_mechanisms: ["file:x.ts"] },
        { heading: "B", key_points: ["k2"], cite_from: [], covers_mechanisms: [] },
      ],
      out_of_scope_mechanisms: [],
    });
    mockGenerateText.mockResolvedValueOnce({
      text: validOutline,
      usage: { inputTokens: 10, outputTokens: 5 },
    } as never);

    const mechanisms: Mechanism[] = [
      { id: "file:x.ts", citation: { kind: "file", target: "x.ts" }, description: "the X thing", coverageRequirement: "must_cite" },
    ];

    const planner = new OutlinePlanner({ model: {} as never });
    const result = await planner.planWithMetrics({
      pageTitle: "Page",
      pageRationale: "r",
      coveredFiles: ["x.ts"],
      language: "en",
      ledger: [],
      findings: [],
      mechanisms,
    });

    const callArgs = mockGenerateText.mock.calls[0][0] as { prompt?: string; messages?: unknown[] };
    const promptText = (callArgs.prompt ?? JSON.stringify(callArgs.messages ?? "")).toString();
    expect(promptText).toContain("file:x.ts");
    expect(promptText).toContain("the X thing");
    expect(result.outline.sections[0].covers_mechanisms).toEqual(["file:x.ts"]);
  });

  it("retries with instruction when outline misses a mechanism", async () => {
    const { generateText } = await import("ai");
    const mockGenerateText = vi.mocked(generateText);

    mockGenerateText.mockResolvedValueOnce({
      text: JSON.stringify({
        sections: [{ heading: "A", key_points: ["k"], cite_from: [], covers_mechanisms: ["file:m1"] }],
        out_of_scope_mechanisms: [],
      }),
      usage: { inputTokens: 10, outputTokens: 5 },
    } as never);

    mockGenerateText.mockResolvedValueOnce({
      text: JSON.stringify({
        sections: [{ heading: "A", key_points: ["k"], cite_from: [], covers_mechanisms: ["file:m1", "file:m2"] }],
        out_of_scope_mechanisms: [],
      }),
      usage: { inputTokens: 10, outputTokens: 5 },
    } as never);

    const mechanisms: Mechanism[] = [
      { id: "file:m1", citation: { kind: "file", target: "m1" }, description: "m1", coverageRequirement: "must_cite" },
      { id: "file:m2", citation: { kind: "file", target: "m2" }, description: "m2", coverageRequirement: "must_cite" },
    ];

    const planner = new OutlinePlanner({ model: {} as never });
    const result = await planner.planWithMetrics({
      pageTitle: "Page", pageRationale: "r", coveredFiles: ["m1", "m2"], language: "en",
      ledger: [], findings: [], mechanisms,
    });

    expect(mockGenerateText).toHaveBeenCalledTimes(2);
    expect(result.outline.sections[0].covers_mechanisms).toContain("file:m2");
  });

  it("forces allocation to last section when retry still misses a mechanism", async () => {
    const { generateText } = await import("ai");
    const mockGenerateText = vi.mocked(generateText);

    const missingOutline = JSON.stringify({
      sections: [
        { heading: "A", key_points: ["k1"], cite_from: [], covers_mechanisms: ["file:m1"] },
        { heading: "B", key_points: ["k2"], cite_from: [], covers_mechanisms: [] },
      ],
      out_of_scope_mechanisms: [],
    });
    mockGenerateText.mockResolvedValueOnce({ text: missingOutline, usage: { inputTokens: 10, outputTokens: 5 } } as never);
    mockGenerateText.mockResolvedValueOnce({ text: missingOutline, usage: { inputTokens: 10, outputTokens: 5 } } as never);

    const mechanisms: Mechanism[] = [
      { id: "file:m1", citation: { kind: "file", target: "m1" }, description: "m1", coverageRequirement: "must_cite" },
      { id: "file:m2", citation: { kind: "file", target: "m2" }, description: "m2", coverageRequirement: "must_cite" },
    ];

    const planner = new OutlinePlanner({ model: {} as never });
    const result = await planner.planWithMetrics({
      pageTitle: "Page", pageRationale: "r", coveredFiles: ["m1", "m2"], language: "en",
      ledger: [], findings: [], mechanisms,
    });

    expect(mockGenerateText).toHaveBeenCalledTimes(2);
    const sections = result.outline.sections;
    expect(sections[sections.length - 1].covers_mechanisms).toContain("file:m2");
    expect(result.usedFallback).toBe(true);
  });

  it("accepts out_of_scope declarations as valid coverage", async () => {
    const { generateText } = await import("ai");
    const mockGenerateText = vi.mocked(generateText);

    mockGenerateText.mockResolvedValueOnce({
      text: JSON.stringify({
        sections: [{ heading: "A", key_points: ["k"], cite_from: [], covers_mechanisms: ["file:m1"] }],
        out_of_scope_mechanisms: [{ id: "file:m2", reason: "covered in another-page-slug" }],
      }),
      usage: { inputTokens: 10, outputTokens: 5 },
    } as never);

    const mechanisms: Mechanism[] = [
      { id: "file:m1", citation: { kind: "file", target: "m1" }, description: "m1", coverageRequirement: "must_cite" },
      { id: "file:m2", citation: { kind: "file", target: "m2" }, description: "m2", coverageRequirement: "must_cite" },
    ];

    const planner = new OutlinePlanner({ model: {} as never });
    const result = await planner.planWithMetrics({
      pageTitle: "Page", pageRationale: "r", coveredFiles: ["m1", "m2"], language: "en",
      ledger: [], findings: [], mechanisms,
    });

    expect(mockGenerateText).toHaveBeenCalledTimes(1);
    expect(result.outline.out_of_scope_mechanisms).toEqual([{ id: "file:m2", reason: "covered in another-page-slug" }]);
  });

  it("drops out_of_scope entries with fabricated ids (not in input)", async () => {
    const { generateText } = await import("ai");
    const mockGenerateText = vi.mocked(generateText);

    // LLM returns an out_of_scope declaration for an id not in input — should be dropped,
    // triggering retry because m1 is now unallocated.
    mockGenerateText.mockResolvedValueOnce({
      text: JSON.stringify({
        sections: [{ heading: "A", key_points: ["k"], cite_from: [], covers_mechanisms: [] }],
        out_of_scope_mechanisms: [{ id: "file:fabricated.ts", reason: "covered elsewhere properly" }],
      }),
      usage: { inputTokens: 10, outputTokens: 5 },
    } as never);
    // Retry adds m1
    mockGenerateText.mockResolvedValueOnce({
      text: JSON.stringify({
        sections: [{ heading: "A", key_points: ["k"], cite_from: [], covers_mechanisms: ["file:m1"] }],
        out_of_scope_mechanisms: [],
      }),
      usage: { inputTokens: 10, outputTokens: 5 },
    } as never);

    const mechanisms: Mechanism[] = [
      { id: "file:m1", citation: { kind: "file", target: "m1" }, description: "m1", coverageRequirement: "must_cite" },
    ];

    const planner = new OutlinePlanner({ model: {} as never });
    const result = await planner.planWithMetrics({
      pageTitle: "Page", pageRationale: "r", coveredFiles: ["m1"], language: "en",
      ledger: [], findings: [], mechanisms,
    });

    // Retry was required because fabricated id was dropped
    expect(mockGenerateText).toHaveBeenCalledTimes(2);
    // Final outline has m1 allocated to section, no fabricated id anywhere
    expect(result.outline.sections[0].covers_mechanisms).toContain("file:m1");
    expect(result.outline.out_of_scope_mechanisms ?? []).toEqual([]);
  });

  it("drops out_of_scope entries with reason shorter than 10 chars", async () => {
    const { generateText } = await import("ai");
    const mockGenerateText = vi.mocked(generateText);

    mockGenerateText.mockResolvedValueOnce({
      text: JSON.stringify({
        sections: [{ heading: "A", key_points: ["k"], cite_from: [], covers_mechanisms: ["file:m1"] }],
        out_of_scope_mechanisms: [{ id: "file:m2", reason: "nope" }], // <10 chars
      }),
      usage: { inputTokens: 10, outputTokens: 5 },
    } as never);
    mockGenerateText.mockResolvedValueOnce({
      text: JSON.stringify({
        sections: [{ heading: "A", key_points: ["k"], cite_from: [], covers_mechanisms: ["file:m1", "file:m2"] }],
        out_of_scope_mechanisms: [],
      }),
      usage: { inputTokens: 10, outputTokens: 5 },
    } as never);

    const mechanisms: Mechanism[] = [
      { id: "file:m1", citation: { kind: "file", target: "m1" }, description: "m1", coverageRequirement: "must_cite" },
      { id: "file:m2", citation: { kind: "file", target: "m2" }, description: "m2", coverageRequirement: "must_cite" },
    ];

    const planner = new OutlinePlanner({ model: {} as never });
    const result = await planner.planWithMetrics({
      pageTitle: "Page", pageRationale: "r", coveredFiles: ["m1", "m2"], language: "en",
      ledger: [], findings: [], mechanisms,
    });

    expect(mockGenerateText).toHaveBeenCalledTimes(2);
    expect(result.outline.sections[0].covers_mechanisms).toContain("file:m2");
  });

  it("keeps out_of_scope entries that satisfy both id-validity and reason-length", async () => {
    const { generateText } = await import("ai");
    const mockGenerateText = vi.mocked(generateText);

    mockGenerateText.mockResolvedValueOnce({
      text: JSON.stringify({
        sections: [{ heading: "A", key_points: ["k"], cite_from: [], covers_mechanisms: ["file:m1"] }],
        out_of_scope_mechanisms: [{ id: "file:m2", reason: "covered in related-page-slug" }],
      }),
      usage: { inputTokens: 10, outputTokens: 5 },
    } as never);

    const mechanisms: Mechanism[] = [
      { id: "file:m1", citation: { kind: "file", target: "m1" }, description: "m1", coverageRequirement: "must_cite" },
      { id: "file:m2", citation: { kind: "file", target: "m2" }, description: "m2", coverageRequirement: "must_cite" },
    ];

    const planner = new OutlinePlanner({ model: {} as never });
    const result = await planner.planWithMetrics({
      pageTitle: "Page", pageRationale: "r", coveredFiles: ["m1", "m2"], language: "en",
      ledger: [], findings: [], mechanisms,
    });

    // No retry needed: valid out_of_scope
    expect(mockGenerateText).toHaveBeenCalledTimes(1);
    expect(result.outline.out_of_scope_mechanisms).toEqual([{ id: "file:m2", reason: "covered in related-page-slug" }]);
  });

  it("omits mechanism-enforcement when mechanisms array is empty", async () => {
    const { generateText } = await import("ai");
    const mockGenerateText = vi.mocked(generateText);

    mockGenerateText.mockResolvedValueOnce({
      text: JSON.stringify({
        sections: [
          { heading: "A", key_points: ["k"], cite_from: [] },
          { heading: "B", key_points: ["k2"], cite_from: [] },
        ],
      }),
      usage: { inputTokens: 10, outputTokens: 5 },
    } as never);

    const planner = new OutlinePlanner({ model: {} as never });
    const result = await planner.planWithMetrics({
      pageTitle: "Page", pageRationale: "r", coveredFiles: [], language: "en",
      ledger: [], findings: [], mechanisms: [],
    });

    expect(mockGenerateText).toHaveBeenCalledTimes(1);
    expect(result.outline.sections[0].heading).toBe("A");
  });
});
