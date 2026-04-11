import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { GenerationPipeline } from "../generation-pipeline.js";
import { StorageAdapter } from "../../storage/storage-adapter.js";
import { JobStateManager } from "../job-state.js";
import type { ResolvedConfig } from "../../types/config.js";
import { getQualityProfile } from "../../config/quality-profile.js";

vi.mock("ai", () => ({
  generateText: vi.fn(),
  jsonSchema: vi.fn((s: unknown) => s),
  stepCountIs: vi.fn(() => () => false),
}));

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

const reviseWithFactualRisks = JSON.stringify({
  verdict: "revise",
  blockers: [],
  factual_risks: ["Incorrect claim about API"],
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

describe("Evidence re-collection on factual risks", () => {
  let tmpDir: string;
  let storage: StorageAdapter;
  let jobManager: JobStateManager;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "reporead-evidence-replan-"),
    );
    storage = new StorageAdapter(tmpDir);
    await storage.initialize();
    jobManager = new JobStateManager(storage);
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("re-collects evidence and re-plans outline when reviewer flags factual_risks", async () => {
    const { generateText } = await import("ai");
    const mockGenerateText = vi.mocked(generateText);

    // Call sequence (budget preset, forkWorkers=1, maxRevisionAttempts=1):
    //   1. Catalog planner
    //   Page "overview":
    //     2. fork.worker (attempt 0)
    //     3. outline planner (attempt 0)
    //     4. draft (attempt 0)
    //     5. review → revise with factual_risks
    //     6. fork.worker (attempt 1 — re-collected due to factual_risks)
    //     7. outline planner (attempt 1 — re-planned due to new evidence)
    //     8. draft (attempt 1)
    //     9. review → pass
    //   Page "core":
    //     10. fork.worker
    //     11. outline planner
    //     12. draft
    //     13. review → pass
    // Total = 13

    // 1. Catalog
    mockGenerateText.mockResolvedValueOnce(
      mockResponse(JSON.stringify(wikiJson)),
    );

    // Page "overview" — attempt 0: worker, outline, draft, review (revise)
    mockGenerateText.mockResolvedValueOnce(mockResponse(workerOutput("overview")));
    mockGenerateText.mockResolvedValueOnce(mockResponse(outlineOutput("overview")));
    mockGenerateText.mockResolvedValueOnce(mockResponse(draftOutput("overview", "Overview")));
    mockGenerateText.mockResolvedValueOnce(mockResponse(reviseWithFactualRisks));

    // Page "overview" — attempt 1: worker (re-collect), outline (re-plan), draft, review (pass)
    mockGenerateText.mockResolvedValueOnce(mockResponse(workerOutput("overview")));
    mockGenerateText.mockResolvedValueOnce(mockResponse(outlineOutput("overview")));
    mockGenerateText.mockResolvedValueOnce(mockResponse(draftOutput("overview", "Overview")));
    mockGenerateText.mockResolvedValueOnce(mockResponse(passReview));

    // Page "core": worker, outline, draft, review
    mockGenerateText.mockResolvedValueOnce(mockResponse(workerOutput("core")));
    mockGenerateText.mockResolvedValueOnce(mockResponse(outlineOutput("core")));
    mockGenerateText.mockResolvedValueOnce(mockResponse(draftOutput("core", "Core")));
    mockGenerateText.mockResolvedValueOnce(mockResponse(passReview));

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

    // 13 calls total: 1 catalog + (4+4) overview attempts + 4 core
    // A run without re-collection would only have 9 calls (no re-worker/re-outline).
    expect(mockGenerateText).toHaveBeenCalledTimes(13);
  });
});
