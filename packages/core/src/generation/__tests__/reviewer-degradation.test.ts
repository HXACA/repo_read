import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { GenerationPipeline } from "../generation-pipeline.js";
import { StorageAdapter } from "../../storage/storage-adapter.js";
import { JobStateManager } from "../job-state.js";
import type { ResolvedConfig } from "../../types/config.js";
import { getQualityProfile } from "../../config/quality-profile.js";

vi.mock("ai", () => {
  const generateText = vi.fn();
  return {
    generateText,
    streamText: vi.fn((...args: unknown[]) => {
      const p = generateText(...args);
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

const mockConfig: ResolvedConfig = {
  projectSlug: "proj",
  repoRoot: "/tmp/repo",
  preset: "budget",
  language: "zh",
  roles: {
    "catalog": {
      role: "catalog",
      primaryModel: "claude-sonnet-4-6",
      fallbackModels: [],
      resolvedProvider: "anthropic",
      systemPromptTuningId: "claude",
    },
    "outline": {
      role: "outline",
      primaryModel: "claude-sonnet-4-6",
      fallbackModels: [],
      resolvedProvider: "anthropic",
      systemPromptTuningId: "claude",
    },
    "drafter": {
      role: "drafter",
      primaryModel: "claude-sonnet-4-6",
      fallbackModels: [],
      resolvedProvider: "anthropic",
      systemPromptTuningId: "claude",
    },
    "worker": {
      role: "worker",
      primaryModel: "claude-haiku-4-5-20251001",
      fallbackModels: [],
      resolvedProvider: "anthropic",
      systemPromptTuningId: "claude",
    },
    "reviewer": {
      role: "reviewer",
      primaryModel: "claude-sonnet-4-6",
      fallbackModels: [],
      resolvedProvider: "anthropic",
      systemPromptTuningId: "claude",
    },
  },
  providers: [],
  retrieval: {
    maxParallelReadsPerPage: 5,
    maxReadWindowLines: 500,
    allowControlledBash: true,
  },
  qualityProfile: getQualityProfile("budget"),
};

const wikiJson = {
  summary: "Test project",
  reading_order: [
    {
      slug: "overview",
      title: "Overview",
      rationale: "Start here",
      covered_files: ["README.md"],
    },
    {
      slug: "core",
      title: "Core",
      rationale: "Main logic",
      covered_files: ["src/index.ts"],
    },
  ],
};

const draftOutput = (slug: string, title: string) =>
  `# ${title}

Content for ${slug} page with enough detail to pass structure validation checks and meet minimum length requirements for the page.

[cite:file:src/index.ts:1-10]

\`\`\`json
{
  "summary": "Summary of ${slug}",
  "citations": [{ "kind": "file", "target": "src/index.ts", "locator": "1-10", "note": "Main entry" }],
  "related_pages": []
}
\`\`\``;

const workerOutput = (slug: string) =>
  JSON.stringify({
    directive: `Collect evidence for ${slug}`,
    findings: [`Finding from ${slug}`],
    citations: [
      { kind: "file", target: "src/index.ts", locator: "1-10", note: "entry" },
    ],
    open_questions: [],
  });

const outlineOutput = (slug: string) =>
  JSON.stringify({
    sections: [
      {
        heading: `${slug} 概述`,
        key_points: [`${slug} overview`],
        cite_from: [{ target: "src/index.ts", locator: "1-10" }],
      },
      {
        heading: `${slug} 细节`,
        key_points: [`${slug} details`],
        cite_from: [{ target: "src/index.ts", locator: "1-10" }],
      },
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

const mockResponse = (text: string, extra?: Record<string, unknown>) =>
  ({
    text,
    usage: { inputTokens: 200, outputTokens: 100 },
    ...extra,
  }) as never;

describe("Reviewer degradation", () => {
  let tmpDir: string;
  let storage: StorageAdapter;
  let jobManager: JobStateManager;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "reporead-reviewer-degrade-"),
    );
    storage = new StorageAdapter(tmpDir);
    await storage.initialize();
    jobManager = new JobStateManager(storage);
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("synthesizes unverified pass when reviewer returns success:false", async () => {
    const { generateText } = await import("ai");
    const mockGenerateText = vi.mocked(generateText);

    // Call sequence (budget preset, 2 pages):
    //   1. Catalog planner
    //   Page "overview": worker, outline, draft, review (fails → synthesized)
    //   Page "core": worker, outline, draft, review (passes normally)

    // Call 1: Catalog
    mockGenerateText.mockResolvedValueOnce(
      mockResponse(JSON.stringify(wikiJson)),
    );

    // Page "overview": worker, outline, draft, review (throws → success:false)
    mockGenerateText.mockResolvedValueOnce(mockResponse(workerOutput("overview")));
    mockGenerateText.mockResolvedValueOnce(mockResponse(outlineOutput("overview")));
    mockGenerateText.mockResolvedValueOnce(mockResponse(draftOutput("overview", "Overview")));
    // Reviewer's generateText throws → FreshReviewer.review() catches and returns { success: false }
    mockGenerateText.mockRejectedValueOnce(new Error("LLM API rate limit"));

    // Page "core": worker, outline, draft, review (normal)
    mockGenerateText.mockResolvedValueOnce(mockResponse(workerOutput("core")));
    mockGenerateText.mockResolvedValueOnce(mockResponse(outlineOutput("core")));
    mockGenerateText.mockResolvedValueOnce(mockResponse(draftOutput("core", "Core")));
    mockGenerateText.mockResolvedValueOnce(mockResponse(passReview));

    const pipeline = new GenerationPipeline({
      storage,
      jobManager,
      config: mockConfig,
      catalogModel: {} as never,
      outlineModel: {} as never,
      drafterModel: {} as never,
      workerModel: {} as never,
      reviewerModel: {} as never,
      repoRoot: tmpDir,
      commitHash: "abc123",
    });

    const job = await jobManager.create("proj", tmpDir, mockConfig);
    const result = await pipeline.run(job);

    // Pipeline must succeed despite reviewer failure on first page
    expect(result.success).toBe(true);
    expect(result.job.status).toBe("completed");

    // After publish, draft dir is promoted to version dir, so read from version path.
    const rJob = result.job;
    const overviewMetaPath = storage.paths.versionPageMeta(
      "proj",
      rJob.versionId,
      "overview",
    );
    const overviewMeta = JSON.parse(await fs.readFile(overviewMetaPath, "utf-8"));
    expect(overviewMeta.reviewStatus).toBe("unverified");

    // Core page meta must have normal reviewStatus: "accepted"
    const coreMetaPath = storage.paths.versionPageMeta(
      "proj",
      rJob.versionId,
      "core",
    );
    const coreMeta = JSON.parse(await fs.readFile(coreMetaPath, "utf-8"));
    expect(coreMeta.reviewStatus).toBe("accepted");
  });

  it("synthesizes unverified pass when reviewer.review() throws unexpectedly", async () => {
    const { generateText } = await import("ai");
    const mockGenerateText = vi.mocked(generateText);

    // Same scenario: reviewer generateText throws for overview,
    // FreshReviewer.review() catches it and returns { success: false }.
    // The pipeline's own try/catch also handles any unexpected throw.

    mockGenerateText.mockResolvedValueOnce(
      mockResponse(JSON.stringify(wikiJson)),
    );

    // Page "overview": worker, outline, draft, review (throws)
    mockGenerateText.mockResolvedValueOnce(mockResponse(workerOutput("overview")));
    mockGenerateText.mockResolvedValueOnce(mockResponse(outlineOutput("overview")));
    mockGenerateText.mockResolvedValueOnce(mockResponse(draftOutput("overview", "Overview")));
    mockGenerateText.mockRejectedValueOnce(new Error("Network timeout"));

    // Page "core": worker, outline, draft, review (normal)
    mockGenerateText.mockResolvedValueOnce(mockResponse(workerOutput("core")));
    mockGenerateText.mockResolvedValueOnce(mockResponse(outlineOutput("core")));
    mockGenerateText.mockResolvedValueOnce(mockResponse(draftOutput("core", "Core")));
    mockGenerateText.mockResolvedValueOnce(mockResponse(passReview));

    const pipeline = new GenerationPipeline({
      storage,
      jobManager,
      config: mockConfig,
      catalogModel: {} as never,
      outlineModel: {} as never,
      drafterModel: {} as never,
      workerModel: {} as never,
      reviewerModel: {} as never,
      repoRoot: tmpDir,
      commitHash: "abc123",
    });

    const job = await jobManager.create("proj", tmpDir, mockConfig);
    const result = await pipeline.run(job);

    expect(result.success).toBe(true);
    expect(result.job.status).toBe("completed");

    const rJob = result.job;
    const metaPath = storage.paths.versionPageMeta(
      "proj",
      rJob.versionId,
      "overview",
    );
    const meta = JSON.parse(await fs.readFile(metaPath, "utf-8"));
    expect(meta.reviewStatus).toBe("unverified");
  });
});
