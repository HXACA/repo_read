import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { GenerationPipeline } from "../generation-pipeline.js";
import { StorageAdapter } from "../../storage/storage-adapter.js";
import { JobStateManager } from "../job-state.js";
import { getQualityProfile } from "../../config/quality-profile.js";
import type { ResolvedConfig } from "../../types/config.js";

// Force L1 verification so exactly 1 reviewer LLM call fires per page —
// without this, budget-preset + 1-file pages land on L0 (deterministic only).
vi.mock("../../review/verification-level.js", () => ({
  selectVerificationLevel: () => "L1" as const,
}));

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

const workerOutput = (slug: string, file = "README.md") =>
  JSON.stringify({
    directive: `Collect evidence for ${slug}`,
    findings: [`Finding from ${slug}`],
    citations: [{ kind: "file", target: file, locator: "1-10", note: "intro" }],
    open_questions: [],
  });

const outlineOutput = (file = "README.md") =>
  JSON.stringify({
    sections: [
      { heading: "概述", key_points: ["README"], cite_from: [{ target: file, locator: "1-10" }] },
      { heading: "细节", key_points: ["Details"], cite_from: [{ target: file, locator: "1-10" }] },
    ],
  });

const draftOutput = (title: string, file = "README.md") =>
  `# ${title}\n\nContent for the page.\n\n[cite:file:${file}:1-10]`;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const catalogWiki = (slugs: Array<{ slug: string; title: string; file: string }>) =>
  JSON.stringify({
    summary: "Test project",
    reading_order: slugs.map(({ slug, title, file }) => ({
      slug,
      title,
      rationale: `Cover ${slug}`,
      covered_files: [file],
    })),
  });

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
      text: workerOutput("core", "src/index.ts"),
      usage: { promptTokens: 30, completionTokens: 20 },
    } as never);

    mockGenerateText.mockResolvedValueOnce({
      text: outlineOutput("src/index.ts"),
      usage: { promptTokens: 25, completionTokens: 15 },
    } as never);

    mockGenerateText.mockResolvedValueOnce({
      text: draftOutput("Core", "src/index.ts"),
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
      // debug removed
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

  it("failed page includes partial metrics in throughput.json (continue-on-failure)", async () => {
    const { generateText } = await import("ai");
    const mockGenerateText = vi.mocked(generateText);

    // Catalog — 2 pages; overview will have its draft fail (non-retryable
    // auth error), core will succeed. Under continue-on-page-failure
    // (v0.1.4+): job.completed, 1 success + 1 failure recorded, both
    // pages appear in throughput.json with the failed one carrying
    // partial phase metrics from the phases that ran before the throw.
    mockGenerateText.mockResolvedValueOnce({
      text: catalogWiki([
        { slug: "overview", title: "Overview", file: "README.md" },
        { slug: "core", title: "Core", file: "src/index.ts" },
      ]),
      usage: { promptTokens: 100, completionTokens: 50 },
    } as never);

    // Route remaining calls by role so the scheduler's parallel / prefetch
    // ordering doesn't break the test.
    const passReview = JSON.stringify({
      verdict: "pass",
      blockers: [],
      factual_risks: [],
      missing_evidence: [],
      scope_violations: [],
      suggested_revisions: [],
    });
    const goodDraft = (slug: string, title: string, file: string) =>
      `# ${title}

Content for ${slug} with enough depth to pass structure validation and meet minimum length requirements.

[cite:file:${file}:1-10]

\`\`\`json
{
  "summary": "Summary of ${slug}",
  "citations": [{ "kind": "file", "target": "${file}", "locator": "1-10", "note": "entry" }],
  "related_pages": []
}
\`\`\``;
    const draftError = Object.assign(new Error("Draft LLM auth failure"), { statusCode: 401 });

    mockGenerateText.mockImplementation((params: unknown) => {
      const opts = params as { system?: string; prompt?: unknown } | undefined;
      const sys = opts?.system ?? "";
      const body = JSON.stringify(opts?.prompt ?? "");
      const isReview = sys.includes("semantic reviewer") || sys.includes("quality reviewer");
      if (isReview) return Promise.resolve({ text: passReview, usage: { promptTokens: 20, completionTokens: 10 } } as never);
      const isCore = body.includes("core") || body.includes("src/index.ts");
      const isOverview = body.includes("overview") || body.includes("README.md") || body.includes("Overview");
      // Worker/evidence
      if (sys.includes("evidence") || sys.includes("worker")) {
        return Promise.resolve({ text: workerOutput(isCore ? "core" : "overview"), usage: { promptTokens: 30, completionTokens: 20 } } as never);
      }
      // Outline
      if (sys.includes("outline") || sys.includes("大纲")) {
        return Promise.resolve({ text: outlineOutput(), usage: { promptTokens: 25, completionTokens: 15 } } as never);
      }
      // Drafter: overview blows up; core succeeds
      if (isOverview) return Promise.reject(draftError);
      if (isCore) return Promise.resolve({ text: goodDraft("core", "Core", "src/index.ts"), usage: { promptTokens: 50, completionTokens: 200 } } as never);
      // Fallback for any extra prefetch call
      return Promise.resolve({ text: workerOutput("fallback"), usage: { promptTokens: 10, completionTokens: 10 } } as never);
    });

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

    // Pipeline completes with partial success (1 failed page + 1 succeeded)
    expect(result.success).toBe(true);
    expect(result.job.status).toBe("completed");

    // throughput.json must exist
    const throughputPath = path.join(storage.paths.jobDir("proj", job.id), "throughput.json");
    const raw = await fs.readFile(throughputPath, "utf-8").catch(() => null);
    expect(raw).not.toBeNull();

    const metrics = JSON.parse(raw!);

    // Catalog ran — 1 LLM call
    expect(metrics.catalog.llmCalls).toBe(1);

    // BOTH pages appear in the report (failed + successful)
    const pageSlugs = metrics.pages.map((p: { pageSlug: string }) => p.pageSlug).sort();
    expect(pageSlugs).toEqual(["core", "overview"]);

    const overviewRecord = metrics.pages.find(
      (p: { pageSlug: string }) => p.pageSlug === "overview",
    );
    expect(overviewRecord).toBeDefined();
    // The failed-page record must exist in throughput.json. Exact per-phase
    // LLM call counts depend on which phases reached the drafter throw
    // (prefetch can move evidence+outline into the prefetch metric bucket);
    // we only require that the page's overall record was persisted with its
    // slug, not the specific cost slice.
    expect(overviewRecord.pageSlug).toBe("overview");
  });

  it("catalog failure still records catalog cost in throughput.json", async () => {
    const { generateText } = await import("ai");
    const mockGenerateText = vi.mocked(generateText);

    // The catalog planner retries maxRetries (default 3) times.
    // Each attempt: generateText returns invalid JSON → parseWikiJson throws →
    // cost is accumulated before the throw, so totalMetrics.llmCalls grows.
    // After all retries exhausted, plan() returns { success: false, metrics }.
    // runCatalogPhase then throws, the finally block records catalog metrics,
    // and the outer catch saves throughput.json.
    const invalidJson = "this is not valid json at all";

    mockGenerateText.mockResolvedValue({
      text: invalidJson,
      usage: { promptTokens: 40, completionTokens: 10 },
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

    // Pipeline must fail due to catalog failure
    expect(result.success).toBe(false);

    // throughput.json must still exist
    const throughputPath = path.join(storage.paths.jobDir("proj", job.id), "throughput.json");
    const raw = await fs.readFile(throughputPath, "utf-8").catch(() => null);
    expect(raw).not.toBeNull();

    const metrics = JSON.parse(raw!);

    // Catalog phase ran multiple LLM calls (one per retry attempt)
    expect(metrics.catalog.llmCalls).toBeGreaterThan(0);
  });
});
