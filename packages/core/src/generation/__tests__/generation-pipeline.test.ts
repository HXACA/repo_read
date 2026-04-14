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

// Use the budget preset for tests: forkWorkers=1 short-circuits the
// planner LLM call (no extra mock needed) and the evidence coordinator
// makes exactly 1 worker call per draft attempt.
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

const draftOutput = (slug: string, title: string, file = "src/index.ts") =>
  `# ${title}

Content for ${slug} page with enough detail to pass structure validation checks and meet minimum length requirements for the page.

[cite:file:${file}:1-10]

\`\`\`json
{
  "summary": "Summary of ${slug}",
  "citations": [{ "kind": "file", "target": "${file}", "locator": "1-10", "note": "Main entry" }],
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

/** Shorthand for a mock LLM response used by outline/worker/draft/review steps. */
const mockResponse = (text: string, extra?: Record<string, unknown>) =>
  ({
    text,
    usage: { inputTokens: 200, outputTokens: 100 },
    ...extra,
  }) as never;

describe("GenerationPipeline", () => {
  let tmpDir: string;
  let storage: StorageAdapter;
  let jobManager: JobStateManager;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "reporead-pipeline-"));
    storage = new StorageAdapter(tmpDir);
    await storage.initialize();
    jobManager = new JobStateManager(storage);
    vi.resetAllMocks();
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
    //     - 1 worker call (coordinator with forkWorkers=1)
    //     - 1 outline planner call
    //     - 1 draft call
    //     - L0 review (deterministic, no LLM call — budget+fast lane, score ≤ 4)

    // Call 1: Catalog planner
    mockGenerateText.mockResolvedValueOnce(mockResponse(JSON.stringify(wikiJson)));

    // Page "overview": worker, outline, draft (L0 review = no LLM)
    mockGenerateText.mockResolvedValueOnce(mockResponse(workerOutput("overview")));
    mockGenerateText.mockResolvedValueOnce(mockResponse(outlineOutput("overview")));
    mockGenerateText.mockResolvedValueOnce(mockResponse(draftOutput("overview", "Overview", "README.md")));

    // Page "core": worker, outline, draft (L0 review = no LLM)
    mockGenerateText.mockResolvedValueOnce(mockResponse(workerOutput("core")));
    mockGenerateText.mockResolvedValueOnce(mockResponse(outlineOutput("core")));
    mockGenerateText.mockResolvedValueOnce(mockResponse(draftOutput("core", "Core")));

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
    // page ("core"): worker + outline + draft. Review is L0 (deterministic,
    // no LLM call) because budget+fast lane with score ≤ 4.
    // Catalog must NOT be called again, and overview must NOT be re-drafted.
    vi.resetAllMocks();
    mockGenerateText.mockResolvedValueOnce(mockResponse(workerOutput("core")));
    mockGenerateText.mockResolvedValueOnce(mockResponse(outlineOutput("core")));
    mockGenerateText.mockResolvedValueOnce(mockResponse(draftOutput("core", "Core")));

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

    const result = await pipeline.run(job, {
      resumeWith: {
        wiki: wikiJson,
        skipPageSlugs: new Set(["overview"]),
      },
    });

    expect(result.success).toBe(true);
    expect(result.job.status).toBe("completed");
    // The LLM was only called 3 times (worker + outline + draft for "core";
    // L0 review is deterministic), not 7+ (catalog + 2× worker/outline/draft).
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

  it("truncated draft triggers shorten-retry without calling reviewer", async () => {
    const { generateText } = await import("ai");
    const mockGenerateText = vi.mocked(generateText);

    // Call sequence (budget preset, 2 pages; forkWorkers=1, maxRevisionAttempts=1):
    //   1. Catalog planner
    //   Page "overview":
    //     2. worker
    //     3. outline planner
    //     4. draft attempt 0 → TRUNCATED (finishReason=length)
    //        pipeline synthesizes revise, skips reviewer, no re-collect
    //     5. draft attempt 1 → normal
    //     6. review pass
    //   Page "core":
    //     7. worker
    //     8. outline planner
    //     9. draft
    //     10. review pass
    // Total = 10. Only ONE reviewer call for "overview".

    mockGenerateText.mockResolvedValueOnce(mockResponse(JSON.stringify(wikiJson)));

    // --- overview: worker, outline, truncated-draft, retry-draft, L1-review, L2-review ---
    // After truncation, draftTruncated signal triggers deep lane → L2 verification,
    // which runs L1 (1 LLM call) then L2 (1 LLM call) = 2 review calls.
    mockGenerateText.mockResolvedValueOnce(mockResponse(workerOutput("overview")));
    mockGenerateText.mockResolvedValueOnce(mockResponse(outlineOutput("overview")));
    mockGenerateText.mockResolvedValueOnce(
      mockResponse("# Overview\n\nContent that got cut off mid-", { finishReason: "length" }),
    );
    mockGenerateText.mockResolvedValueOnce(mockResponse(draftOutput("overview", "Overview", "README.md")));
    mockGenerateText.mockResolvedValueOnce(mockResponse(passReview)); // L1 review
    mockGenerateText.mockResolvedValueOnce(mockResponse(passReview)); // L2 review

    // --- core: worker, outline, draft (L0 review — no LLM call) ---
    // Budget preset + 1 file → fast lane, score ≤ 4 → L0 (deterministic only)
    mockGenerateText.mockResolvedValueOnce(mockResponse(workerOutput("core")));
    mockGenerateText.mockResolvedValueOnce(mockResponse(outlineOutput("core")));
    mockGenerateText.mockResolvedValueOnce(mockResponse(draftOutput("core", "Core")));

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
    expect(mockGenerateText).toHaveBeenCalledTimes(10);

    // Event stream should show:
    //  - 3× page.drafting (overview attempt 0 + overview attempt 1 + core)
    //  - 3× page.reviewed (overview synthesized revise + overview real pass + core pass)
    //  - 2× page.validated (one per page)
    const reader = new EventReader(storage.paths.eventsNdjson("proj", job.id));
    const events = await reader.readAll();
    const draftEvents = events.filter((e) => e.type === "page.drafting");
    const reviewEvents = events.filter((e) => e.type === "page.reviewed");
    const validateEvents = events.filter((e) => e.type === "page.validated");
    expect(draftEvents).toHaveLength(3);
    expect(reviewEvents).toHaveLength(3);
    expect(validateEvents).toHaveLength(2);

    // Overview's first reviewer event should be the synthesized revise
    const overviewReviews = reviewEvents.filter(
      (e) => (e as { pageSlug?: string }).pageSlug === "overview",
    );
    const verdicts = overviewReviews.map(
      (e) => (e as { payload?: { verdict?: string } }).payload?.verdict,
    );
    expect(verdicts).toEqual(["revise", "pass"]);
  });
});
