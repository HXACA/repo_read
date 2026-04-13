import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { ResearchService } from "../research-service.js";
import { StorageAdapter } from "../../storage/storage-adapter.js";

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

describe("ResearchService", () => {
  let tmpDir: string;
  let storage: StorageAdapter;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "reporead-research-"));
    storage = new StorageAdapter(tmpDir);
    await storage.initialize();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("runs full research pipeline: plan → investigate → synthesize → persist", async () => {
    const { generateText } = await import("ai");
    const mock = vi.mocked(generateText);

    // Call 1: plan
    mock.mockResolvedValueOnce({
      text: JSON.stringify({
        topic: "Config system",
        subQuestions: ["How is config loaded?", "What validation exists?"],
        scope: "Configuration loading and validation",
      }),
      usage: { inputTokens: 200, outputTokens: 100 },
    } as never);

    // Call 2: sub-question 1
    mock.mockResolvedValueOnce({
      text: JSON.stringify({
        question: "How is config loaded?",
        findings: ["Config loaded from .reporead/config.json"],
        citations: [
          { kind: "file", target: "config/loader.ts", locator: "1-20", note: "Loader" },
        ],
        openQuestions: [],
      }),
      usage: { inputTokens: 200, outputTokens: 100 },
    } as never);

    // Call 3: sub-question 2
    mock.mockResolvedValueOnce({
      text: JSON.stringify({
        question: "What validation exists?",
        findings: ["Zod schema validates config structure"],
        citations: [
          { kind: "file", target: "config/schema.ts", locator: "5-30", note: "Schema" },
        ],
        openQuestions: [],
      }),
      usage: { inputTokens: 200, outputTokens: 100 },
    } as never);

    // Call 4: synthesis
    mock.mockResolvedValueOnce({
      text: JSON.stringify({
        facts: [
          {
            statement: "Config is loaded from .reporead/config.json",
            citations: [
              { kind: "file", target: "config/loader.ts", locator: "1-20" },
            ],
          },
          {
            statement: "Zod validates the config schema",
            citations: [
              { kind: "file", target: "config/schema.ts", locator: "5-30" },
            ],
          },
        ],
        inferences: [
          {
            statement:
              "Schema validation happens after loading, rejecting invalid configs at parse time",
            citations: [],
          },
        ],
        unconfirmed: [],
        summary:
          "The config system reads from a well-known path and validates structure via Zod before returning the parsed object to callers.",
      }),
      usage: { inputTokens: 400, outputTokens: 200 },
    } as never);

    const service = new ResearchService({
      model: {} as never,
      storage,
      repoRoot: tmpDir,
    });

    const result = await service.research("proj", "v1", "Config system");

    // Plan + sub-results intact
    expect(result.plan.subQuestions).toHaveLength(2);
    expect(result.subResults).toHaveLength(2);

    // Note has three labeled buckets
    expect(result.note.facts).toHaveLength(2);
    expect(result.note.inferences).toHaveLength(1);
    expect(result.note.unconfirmed).toHaveLength(0);
    expect(result.note.summary).toContain("config");
    expect(result.note.id).toBeTruthy();
    expect(result.note.versionId).toBe("v1");

    // Persisted to disk
    const notePath = storage.paths.researchNoteJson(
      "proj",
      "v1",
      result.note.id,
    );
    const persisted = await storage.readJson<typeof result.note>(notePath);
    expect(persisted).not.toBeNull();
    expect(persisted!.facts).toHaveLength(2);
  });

  it("falls back gracefully when synthesis LLM returns garbage", async () => {
    const { generateText } = await import("ai");
    const mock = vi.mocked(generateText);

    // plan + 1 sub-question + synthesis(garbage)
    mock.mockResolvedValueOnce({
      text: JSON.stringify({
        topic: "X",
        subQuestions: ["Q1"],
        scope: "Scope X",
      }),
    } as never);
    mock.mockResolvedValueOnce({
      text: JSON.stringify({
        question: "Q1",
        findings: ["cited finding"],
        citations: [{ kind: "file", target: "a.ts", locator: "1-5" }],
        openQuestions: ["open Q"],
      }),
    } as never);
    mock.mockResolvedValueOnce({
      text: "not valid json at all — model refused",
    } as never);

    const service = new ResearchService({
      model: {} as never,
      storage,
      repoRoot: tmpDir,
    });

    const result = await service.research("proj", "v1", "X");

    // Fallback heuristic: cited finding → fact, open question → unconfirmed
    expect(result.note.facts.length).toBeGreaterThan(0);
    expect(result.note.unconfirmed.length).toBeGreaterThan(0);
    expect(result.note.id).toBeTruthy();
  });
});
