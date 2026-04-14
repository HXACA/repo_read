import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { GenerationPipeline } from "../generation-pipeline.js";
import { StorageAdapter } from "../../storage/storage-adapter.js";
import { JobStateManager } from "../job-state.js";
import { getQualityProfile } from "../../config/quality-profile.js";
import type { ResolvedConfig } from "../../types/config.js";
import type { ThroughputReport } from "../throughput-metrics.js";

// Force L1 verification so the reviewer fires a real LLM call per page.
// Without this, budget-preset + 1-file pages land on L0 (deterministic only),
// which means review finishes instantly and the prefetch window is too narrow.
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

// ---------------------------------------------------------------------------
// Shared config / helpers
// ---------------------------------------------------------------------------

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

const catalogJson = JSON.stringify({
  summary: "Test project",
  reading_order: [
    { slug: "overview", title: "Overview", rationale: "Start here", covered_files: ["README.md"] },
    { slug: "core", title: "Core", rationale: "Main logic", covered_files: ["src/index.ts"] },
  ],
});

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

/** Shorthand for a mock LLM response. */
const mockResponse = (text: string, extra?: Record<string, unknown>) =>
  ({
    text,
    usage: { promptTokens: 50, completionTokens: 25 },
    ...extra,
  }) as never;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Page overlap prefetch integration", () => {
  let tmpDir: string;
  let storage: StorageAdapter;
  let jobManager: JobStateManager;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "reporead-prefetch-integ-"));
    storage = new StorageAdapter(tmpDir);
    await storage.initialize();
    jobManager = new JobStateManager(storage);
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  /**
   * Run a full 2-page pipeline and return the parsed throughput report.
   * Call sequence (budget preset, L1 verification forced):
   *   1. Catalog planner
   *   Page "overview": worker, outline, draft, review (L1)
   *   Page "core": worker, outline, draft, review (L1)
   *   + background prefetch may fire for "core" while "overview" is in review
   */
  async function runTwoPagePipeline(): Promise<ThroughputReport> {
    const { generateText } = await import("ai");
    const mockGenerateText = vi.mocked(generateText);

    // Call 1: Catalog planner
    mockGenerateText.mockResolvedValueOnce(mockResponse(catalogJson));

    // Page "overview": worker, outline, draft, review (L1)
    mockGenerateText.mockResolvedValueOnce(mockResponse(workerOutput("overview")));
    mockGenerateText.mockResolvedValueOnce(mockResponse(outlineOutput()));
    mockGenerateText.mockResolvedValueOnce(mockResponse(draftOutput("Overview")));
    mockGenerateText.mockResolvedValueOnce(mockResponse(passReview));

    // Page "core": worker, outline, draft, review (L1)
    // These mocks are consumed if prefetch didn't already handle evidence/outline.
    mockGenerateText.mockResolvedValueOnce(mockResponse(workerOutput("core", "src/index.ts")));
    mockGenerateText.mockResolvedValueOnce(mockResponse(outlineOutput("src/index.ts")));
    mockGenerateText.mockResolvedValueOnce(mockResponse(draftOutput("Core", "src/index.ts")));
    mockGenerateText.mockResolvedValueOnce(mockResponse(passReview));

    // Default fallback for any extra calls from background prefetch.
    mockGenerateText.mockResolvedValue(mockResponse(workerOutput("prefetch-fallback")));

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

    // Read throughput.json
    const throughputPath = path.join(
      storage.paths.jobDir("proj", job.id),
      "throughput.json",
    );
    const raw = await fs.readFile(throughputPath, "utf-8");
    return JSON.parse(raw) as ThroughputReport;
  }

  it("second page has prefetch field on its throughput record", async () => {
    const report = await runTwoPagePipeline();

    expect(report.pages).toHaveLength(2);

    // The first page ("overview") is never a prefetch target — there is no
    // prior page to trigger prefetch from.
    // The second page ("core") should have a prefetch field because the
    // pipeline starts prefetching it during the first page's review phase.
    const corePage = report.pages.find((p) => p.pageSlug === "core");
    expect(corePage).toBeDefined();
    expect(corePage!.prefetch).toBeDefined();
  });

  it("prefetchHitRate > 0 in the report", async () => {
    const report = await runTwoPagePipeline();

    // At least one page (core) should have a prefetch hit.
    expect(report.prefetchHitRate).toBeGreaterThan(0);
  });

  it("prefetch.phases are NOT double-counted in totals.llmCalls", async () => {
    const report = await runTwoPagePipeline();

    // Sum up all llmCalls from page.phases only (the canonical source).
    let phaseLlmCalls = report.catalog.llmCalls;
    for (const page of report.pages) {
      for (const phase of Object.values(page.phases)) {
        phaseLlmCalls += phase.llmCalls;
      }
    }

    // totals.llmCalls must equal catalog + sum(page.phases), with NO
    // contribution from page.prefetch.phases.
    expect(report.totals.llmCalls).toBe(phaseLlmCalls);

    // Verify prefetch phases exist and would cause a mismatch if counted.
    const corePage = report.pages.find((p) => p.pageSlug === "core");
    if (corePage?.prefetch?.phases?.evidence) {
      // If prefetch evidence was recorded, its llmCalls should NOT appear
      // in the total — meaning total < phaseLlmCalls + prefetch.evidence.llmCalls
      // (already guaranteed by the equality above).
      expect(corePage.prefetch.phases.evidence.llmCalls).toBeGreaterThanOrEqual(0);
    }
  });

  it("prefetch diagnostics have reasonable values", async () => {
    const report = await runTwoPagePipeline();

    const corePage = report.pages.find((p) => p.pageSlug === "core");
    expect(corePage).toBeDefined();
    expect(corePage!.prefetch).toBeDefined();

    const pf = corePage!.prefetch!;

    // hit must be a boolean
    expect(typeof pf.hit).toBe("boolean");

    // waitMs must be non-negative
    expect(pf.waitMs).toBeGreaterThanOrEqual(0);

    // phases object must exist
    expect(pf.phases).toBeDefined();

    // If evidence was prefetched, its metric shape must be valid
    if (pf.phases.evidence) {
      expect(pf.phases.evidence.llmCalls).toBeGreaterThanOrEqual(0);
      expect(pf.phases.evidence.durationMs).toBeGreaterThanOrEqual(0);
      expect(typeof pf.phases.evidence.usage.inputTokens).toBe("number");
      expect(typeof pf.phases.evidence.usage.outputTokens).toBe("number");
    }

    // If outline was prefetched, its metric shape must be valid
    if (pf.phases.outline) {
      expect(pf.phases.outline.llmCalls).toBeGreaterThanOrEqual(0);
      expect(pf.phases.outline.durationMs).toBeGreaterThanOrEqual(0);
      expect(typeof pf.phases.outline.usage.inputTokens).toBe("number");
      expect(typeof pf.phases.outline.usage.outputTokens).toBe("number");
    }
  });
});
