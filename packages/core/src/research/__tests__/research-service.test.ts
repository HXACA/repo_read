import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { ResearchService } from "../research-service.js";
import { StorageAdapter } from "../../storage/storage-adapter.js";

vi.mock("ai", () => ({
  generateText: vi.fn(),
  jsonSchema: vi.fn((s: unknown) => s),
}));

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

  it("runs full research pipeline: plan, investigate, conclude", async () => {
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
        citations: [{ kind: "file", target: "config/loader.ts", locator: "1-20", note: "Loader" }],
        openQuestions: [],
      }),
      usage: { inputTokens: 200, outputTokens: 100 },
    } as never);

    // Call 3: sub-question 2
    mock.mockResolvedValueOnce({
      text: JSON.stringify({
        question: "What validation exists?",
        findings: ["Zod schema validates config structure"],
        citations: [{ kind: "file", target: "config/schema.ts", locator: "5-30", note: "Schema" }],
        openQuestions: [],
      }),
      usage: { inputTokens: 200, outputTokens: 100 },
    } as never);

    const service = new ResearchService({
      model: {} as never,
      storage,
      repoRoot: tmpDir,
    });

    const result = await service.research("proj", "Config system");

    expect(result.plan.subQuestions).toHaveLength(2);
    expect(result.subResults).toHaveLength(2);
    expect(result.allCitations).toHaveLength(2);
    expect(result.conclusion).toContain("Config system");
    expect(result.conclusion).toContain("config.json");
  });
});
