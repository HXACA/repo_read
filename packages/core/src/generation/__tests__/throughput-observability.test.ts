import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { GenerationPipeline } from "../generation-pipeline.js";
import { StorageAdapter } from "../../storage/storage-adapter.js";
import { JobStateManager } from "../job-state.js";
import { getQualityProfile } from "../../config/quality-profile.js";
import type { ResolvedConfig } from "../../types/config.js";

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
        fullStream: (async function* () {})(),
      };
    }),
    jsonSchema: vi.fn((s: unknown) => s),
    stepCountIs: vi.fn(() => () => false),
  };
});

const config: ResolvedConfig = {
  projectSlug: "proj",
  repoRoot: "/tmp/repo",
  preset: "budget",
  language: "zh",
  roles: {
    catalog: { role: "catalog", primaryModel: "m1", fallbackModels: [], resolvedProvider: "anthropic", systemPromptTuningId: "claude" },
    outline: { role: "outline", primaryModel: "m1", fallbackModels: [], resolvedProvider: "anthropic", systemPromptTuningId: "claude" },
    drafter: { role: "drafter", primaryModel: "m1", fallbackModels: [], resolvedProvider: "anthropic", systemPromptTuningId: "claude" },
    worker: { role: "worker", primaryModel: "m1", fallbackModels: [], resolvedProvider: "anthropic", systemPromptTuningId: "claude" },
    reviewer: { role: "reviewer", primaryModel: "m1", fallbackModels: [], resolvedProvider: "anthropic", systemPromptTuningId: "claude" },
  },
  providers: [],
  retrieval: {
    maxParallelReadsPerPage: 5,
    maxReadWindowLines: 500,
    allowControlledBash: true,
  },
  qualityProfile: getQualityProfile("budget"),
};

const passReview = JSON.stringify({
  verdict: "pass",
  blockers: [],
  factual_risks: [],
  missing_evidence: [],
  scope_violations: [],
  suggested_revisions: [],
});

const workerOutput = (slug: string) =>
  JSON.stringify({
    directive: `Collect evidence for ${slug}`,
    findings: [`Finding from ${slug}`],
    citations: [{ kind: "file", target: "README.md", locator: "1-10", note: "intro" }],
    open_questions: [],
  });

const outlineOutput = () =>
  JSON.stringify({
    sections: [
      { heading: "概述", key_points: ["README"], cite_from: [{ target: "README.md", locator: "1-10" }] },
      { heading: "细节", key_points: ["Details"], cite_from: [{ target: "README.md", locator: "1-10" }] },
    ],
  });

const draftOutput = (title: string) =>
  `# ${title}\n\nContent for the page.\n\n[cite:file:README.md:1-10]`;

describe("GenerationPipeline observability", () => {
  let tmpDir: string;
  let storage: StorageAdapter;
  let jobManager: JobStateManager;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "reporead-throughput-"));
    storage = new StorageAdapter(tmpDir);
    await storage.initialize();
    jobManager = new JobStateManager(storage);
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("writes throughput.json with catalog + per-page phase metrics", async () => {
    const { generateText } = await import("ai");
    const mockGenerateText = vi.mocked(generateText);

    // Mock usage follows AI SDK format: promptTokens / completionTokens
    // (extractUsage in agent-loop.ts maps these to inputTokens/outputTokens)

    // Call 1: Catalog planner (returns 2-page wiki)
    mockGenerateText.mockResolvedValueOnce({
      text: JSON.stringify({
        summary: "Test project",
        reading_order: [
          { slug: "overview", title: "Overview", rationale: "Start here", covered_files: ["README.md"] },
          { slug: "core", title: "Core", rationale: "Main logic", covered_files: ["src/index.ts"] },
        ],
      }),
      usage: { promptTokens: 100, completionTokens: 50 },
    } as never);

    // Page "overview": worker (30/20), outline (25/15), draft (80/40), review (40/20)
    mockGenerateText.mockResolvedValueOnce({
      text: workerOutput("overview"),
      usage: { promptTokens: 30, completionTokens: 20 },
    } as never);

    mockGenerateText.mockResolvedValueOnce({
      text: outlineOutput(),
      usage: { promptTokens: 25, completionTokens: 15 },
    } as never);

    mockGenerateText.mockResolvedValueOnce({
      text: draftOutput("Overview"),
      usage: { promptTokens: 80, completionTokens: 40 },
      finishReason: "stop",
    } as never);

    mockGenerateText.mockResolvedValueOnce({
      text: passReview,
      usage: { promptTokens: 40, completionTokens: 20 },
    } as never);

    // Page "core": worker (30/20), outline (25/15), draft (80/40), review (40/20)
    mockGenerateText.mockResolvedValueOnce({
      text: workerOutput("core"),
      usage: { promptTokens: 30, completionTokens: 20 },
    } as never);

    mockGenerateText.mockResolvedValueOnce({
      text: outlineOutput(),
      usage: { promptTokens: 25, completionTokens: 15 },
    } as never);

    mockGenerateText.mockResolvedValueOnce({
      text: draftOutput("Core"),
      usage: { promptTokens: 80, completionTokens: 40 },
      finishReason: "stop",
    } as never);

    mockGenerateText.mockResolvedValueOnce({
      text: passReview,
      usage: { promptTokens: 40, completionTokens: 20 },
    } as never);

    const pipeline = new GenerationPipeline({
      storage,
      jobManager,
      config,
      catalogModel: {} as never,
      outlineModel: {} as never,
      drafterModel: {} as never,
      workerModel: {} as never,
      reviewerModel: {} as never,
      repoRoot: tmpDir,
      commitHash: "abc123",
    });

    const job = await jobManager.create("proj", tmpDir, config);
    const result = await pipeline.run(job);

    if (!result.success) {
      throw new Error(`Pipeline failed: ${result.error}`);
    }
    expect(result.success).toBe(true);

    const throughputPath = path.join(storage.paths.jobDir("proj", job.id), "throughput.json");
    const metrics = JSON.parse(await fs.readFile(throughputPath, "utf-8"));

    // Catalog: 1 LLM call
    expect(metrics.catalog.llmCalls).toBe(1);

    // 2 pages
    expect(metrics.pages).toHaveLength(2);

    // First page: "overview"
    expect(metrics.pages[0].pageSlug).toBe("overview");
    expect(metrics.pages[0].phases.evidence.llmCalls).toBe(1);
    expect(metrics.pages[0].phases.outline.llmCalls).toBe(1);
    expect(metrics.pages[0].phases.draft.llmCalls).toBe(1);
    expect(metrics.pages[0].phases.review.llmCalls).toBe(1);
    expect(metrics.pages[0].phases.validate.llmCalls).toBe(0);
    // Evidence (30) + outline (25) + draft (80) + review (40) = 175
    expect(metrics.pages[0].usage.inputTokens).toBe(175);

    // Second page: "core"
    expect(metrics.pages[1].pageSlug).toBe("core");
    expect(metrics.pages[1].phases.evidence.llmCalls).toBe(1);
    expect(metrics.pages[1].usage.inputTokens).toBe(175);

    // Totals: 1 catalog + (4 per page x 2 pages) = 9
    expect(metrics.totals.llmCalls).toBe(9);
    // Total input: catalog(100) + 2 pages x 175 = 450
    expect(metrics.totals.usage.inputTokens).toBe(450);
  });
});
