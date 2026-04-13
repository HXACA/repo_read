import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { AskService } from "../ask-service.js";
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

const answerOutput = `The engine handles pipeline orchestration through a state machine.

[cite:file:src/engine.ts:10-20]

\`\`\`json
{
  "citations": [
    { "kind": "file", "target": "src/engine.ts", "locator": "10-20", "note": "State machine" }
  ]
}
\`\`\``;

describe("AskService", () => {
  let tmpDir: string;
  let storage: StorageAdapter;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "reporead-ask-svc-"));
    storage = new StorageAdapter(tmpDir);
    await storage.initialize();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("returns answer with citations", async () => {
    const { generateText } = await import("ai");
    vi.mocked(generateText).mockResolvedValueOnce({
      text: answerOutput,
      usage: { inputTokens: 200, outputTokens: 100 },
    } as never);

    const service = new AskService({
      model: {} as never,
      storage,
      repoRoot: tmpDir,
    });

    const result = await service.ask("proj", "v1", "How does the engine work?");
    expect(result.answer).toContain("state machine");
    expect(result.citations).toHaveLength(1);
    expect(result.citations[0].target).toBe("src/engine.ts");
    expect(result.sessionId).toBeDefined();
  });

  it("classifies route correctly", async () => {
    const { generateText } = await import("ai");
    vi.mocked(generateText).mockResolvedValueOnce({
      text: "Simple answer.\n\n```json\n{\"citations\": []}\n```",
      usage: { inputTokens: 100, outputTokens: 50 },
    } as never);

    const service = new AskService({
      model: {} as never,
      storage,
      repoRoot: tmpDir,
    });

    const result = await service.ask("proj", "v1", "Explain the architecture of the entire system");
    expect(result.route).toBe("research");
  });

  it("handles LLM errors gracefully", async () => {
    const { generateText } = await import("ai");
    vi.mocked(generateText).mockRejectedValueOnce(new Error("API timeout"));

    const service = new AskService({
      model: {} as never,
      storage,
      repoRoot: tmpDir,
    });

    const result = await service.ask("proj", "v1", "What is this?");
    expect(result.answer).toContain("error");
    expect(result.citations).toHaveLength(0);
  });
});
