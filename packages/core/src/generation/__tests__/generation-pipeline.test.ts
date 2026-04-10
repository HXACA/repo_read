import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { GenerationPipeline } from "../generation-pipeline.js";
import { StorageAdapter } from "../../storage/storage-adapter.js";
import { JobStateManager } from "../job-state.js";
import { EventReader } from "../../events/event-reader.js";
import type { WikiJson } from "../../types/generation.js";
import type { ResolvedConfig } from "../../types/config.js";
import { getQualityProfile } from "../../config/quality-profile.js";

vi.mock("ai", () => ({
  generateText: vi.fn(),
  jsonSchema: vi.fn((s: unknown) => s),
  stepCountIs: vi.fn(() => () => false),
}));

// Use the budget preset for tests: forkWorkers=1 short-circuits the
// planner LLM call (no extra mock needed) and the evidence coordinator
// makes exactly 1 worker call per draft attempt.
const mockConfig: ResolvedConfig = {
  projectSlug: "proj",
  repoRoot: "/tmp/repo",
  preset: "budget",
  language: "zh",
  roles: {
    "main.author": {
      role: "main.author",
      primaryModel: "claude-sonnet-4-6",
      fallbackModels: [],
      resolvedProvider: "anthropic",
      systemPromptTuningId: "claude",
    },
    "fork.worker": {
      role: "fork.worker",
      primaryModel: "claude-haiku-4-5-20251001",
      fallbackModels: [],
      resolvedProvider: "anthropic",
      systemPromptTuningId: "claude",
    },
    "fresh.reviewer": {
      role: "fresh.reviewer",
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

const wikiJson: WikiJson = {
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
    citations: [
      { kind: "file", target: "src/index.ts", locator: "1-10", note: "entry" },
    ],
    open_questions: [],
  });

describe("GenerationPipeline", () => {
  let tmpDir: string;
  let storage: StorageAdapter;
  let jobManager: JobStateManager;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "reporead-pipeline-"));
    storage = new StorageAdapter(tmpDir);
    await storage.initialize();
    jobManager = new JobStateManager(storage);
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("runs full pipeline from catalog through publish", async () => {
    const { generateText } = await import("ai");
    const mockGenerateText = vi.mocked(generateText);

    // Call sequence (budget preset, forkWorkers=1, fast-path planner):
    //   1. Catalog planner
    //   For each page:
    //     - 1 fork.worker call (coordinator with forkWorkers=1)
    //     - 1 draft call
    //     - 1 review call

    // Call 1: Catalog planner
    mockGenerateText.mockResolvedValueOnce({
      text: JSON.stringify(wikiJson),
      usage: { inputTokens: 500, outputTokens: 300 },
    } as never);

    // Page "overview": worker, draft, review
    mockGenerateText.mockResolvedValueOnce({
      text: workerOutput("overview"),
      usage: { inputTokens: 200, outputTokens: 100 },
    } as never);
    mockGenerateText.mockResolvedValueOnce({
      text: draftOutput("overview", "Overview"),
      usage: { inputTokens: 500, outputTokens: 300 },
    } as never);
    mockGenerateText.mockResolvedValueOnce({
      text: passReview,
      usage: { inputTokens: 300, outputTokens: 100 },
    } as never);

    // Page "core": worker, draft, review
    mockGenerateText.mockResolvedValueOnce({
      text: workerOutput("core"),
      usage: { inputTokens: 200, outputTokens: 100 },
    } as never);
    mockGenerateText.mockResolvedValueOnce({
      text: draftOutput("core", "Core"),
      usage: { inputTokens: 500, outputTokens: 300 },
    } as never);
    mockGenerateText.mockResolvedValueOnce({
      text: passReview,
      usage: { inputTokens: 300, outputTokens: 100 },
    } as never);

    const pipeline = new GenerationPipeline({
      storage,
      jobManager,
      config: mockConfig,
      model: {} as never,
      reviewerModel: {} as never,
      repoRoot: tmpDir,
      commitHash: "abc123",
    });

    const job = await jobManager.create("proj", tmpDir, mockConfig);
    const result = await pipeline.run(job);

    expect(result.success).toBe(true);
    expect(result.job.status).toBe("completed");
    expect(result.job.summary.totalPages).toBe(2);
    expect(result.job.summary.succeededPages).toBe(2);

    // Published version should exist
    const versionExists = await storage.exists(
      storage.paths.versionWikiJson("proj", result.job.versionId),
    );
    expect(versionExists).toBe(true);

    // Events should be recorded
    const reader = new EventReader(storage.paths.eventsNdjson("proj", job.id));
    const events = await reader.readAll();
    const types = events.map((e) => e.type);
    expect(types).toContain("job.started");
    expect(types).toContain("catalog.completed");
    expect(types).toContain("page.drafting");
    expect(types).toContain("page.reviewed");
    expect(types).toContain("page.validated");
    expect(types).toContain("job.completed");
  });

  it("resume: skips catalog + already-validated pages", async () => {
    const { generateText } = await import("ai");
    const mockGenerateText = vi.mocked(generateText);

    // Phase A: simulate a partially-completed prior job by pre-writing
    // wiki.json and a validated meta file for the first page. We never
    // call the pipeline in this phase — just lay the filesystem state
    // a real failed job would leave behind.
    const job = await jobManager.create("proj", tmpDir, mockConfig);

    // Persist wiki.json under the draft dir (simulating persistCatalog)
    await storage.writeJson(
      storage.paths.draftWikiJson("proj", job.id, job.versionId),
      wikiJson,
    );
    // Pre-write a validated meta file for the first page
    const overviewMeta = {
      slug: "overview",
      title: "Overview",
      order: 1,
      sectionId: "overview",
      coveredFiles: ["README.md"],
      relatedPages: [],
      generatedAt: new Date().toISOString(),
      commitHash: "abc123",
      citationFile: "citations/overview.citations.json",
      summary: "Overview summary",
      reviewStatus: "accepted" as const,
      reviewSummary: "No blockers",
      reviewDigest: "{}",
      status: "validated" as const,
      validation: {
        structurePassed: true,
        mermaidPassed: true,
        citationsPassed: true,
        linksPassed: true,
        summary: "passed" as const,
      },
    };
    await storage.writeJson(
      storage.paths.draftPageMeta("proj", job.id, job.versionId, "overview"),
      overviewMeta,
    );
    // Pre-write the markdown too (publisher reads it)
    const pageMdPath = storage.paths.draftPageMd(
      "proj",
      job.id,
      job.versionId,
      "overview",
    );
    await fs.mkdir(path.dirname(pageMdPath), { recursive: true });
    await fs.writeFile(pageMdPath, "# Overview\n\nPre-existing content.", "utf-8");

    // Mark the job as failed so resume can transition it back
    await jobManager.fail("proj", job.id, "simulated network error");

    // Phase B: resume — we only mock the LLM calls for the REMAINING
    // page ("core"): worker + draft + review. Catalog must NOT be
    // called again, and overview must NOT be re-drafted.
    vi.clearAllMocks();
    mockGenerateText.mockResolvedValueOnce({
      text: workerOutput("core"),
      usage: { inputTokens: 200, outputTokens: 100 },
    } as never);
    mockGenerateText.mockResolvedValueOnce({
      text: draftOutput("core", "Core"),
      usage: { inputTokens: 500, outputTokens: 300 },
    } as never);
    mockGenerateText.mockResolvedValueOnce({
      text: passReview,
      usage: { inputTokens: 300, outputTokens: 100 },
    } as never);

    const pipeline = new GenerationPipeline({
      storage,
      jobManager,
      config: mockConfig,
      model: {} as never,
      reviewerModel: {} as never,
      repoRoot: tmpDir,
      commitHash: "abc123",
    });

    const result = await pipeline.run(job, {
      resumeWith: {
        wiki: wikiJson,
        skipPageSlugs: new Set(["overview"]),
      },
    });

    expect(result.success).toBe(true);
    expect(result.job.status).toBe("completed");
    // The LLM was only called 3 times (worker + draft + review for "core"),
    // not 7 (which would be catalog + 2× worker/draft/review for both pages).
    expect(mockGenerateText).toHaveBeenCalledTimes(3);

    // Published version must exist AND include both pages (overview was
    // pre-written, core was freshly drafted).
    const publishedWikiPath = storage.paths.versionWikiJson(
      "proj",
      result.job.versionId,
    );
    expect(await storage.exists(publishedWikiPath)).toBe(true);
    const overviewPath = storage.paths.versionPageMd(
      "proj",
      result.job.versionId,
      "overview",
    );
    const corePath = storage.paths.versionPageMd(
      "proj",
      result.job.versionId,
      "core",
    );
    expect(await storage.exists(overviewPath)).toBe(true);
    expect(await storage.exists(corePath)).toBe(true);

    // Event stream must NOT contain a catalog.completed event (no catalog
    // re-run) but MUST contain job.resumed.
    const reader = new EventReader(storage.paths.eventsNdjson("proj", job.id));
    const events = await reader.readAll();
    const types = events.map((e) => e.type);
    expect(types).not.toContain("catalog.completed");
    expect(types).toContain("job.resumed");
    // Only the "core" page should have been drafted this run
    const draftedSlugs = events
      .filter((e) => e.type === "page.drafting")
      .map((e) => e.pageSlug);
    expect(draftedSlugs).toEqual(["core"]);
  });
});
