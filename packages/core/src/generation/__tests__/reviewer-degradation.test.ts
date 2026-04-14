import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { GenerationPipeline } from "../generation-pipeline.js";
import { StorageAdapter } from "../../storage/storage-adapter.js";
import { JobStateManager } from "../job-state.js";
import type { ResolvedConfig } from "../../types/config.js";
import { getQualityProfile } from "../../config/quality-profile.js";

// Force L2 verification so the full reviewer LLM path fires —
// without this, budget-preset + 1-file pages land on L0 (deterministic only).
vi.mock("../../review/verification-level.js", () => ({
  selectVerificationLevel: () => "L2" as const,
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

    // Call sequence (budget preset, 2 pages, L2 forced):
    //   1. Catalog planner
    //   Page "overview": worker, outline, draft, L1-review (fails), L2-review (fails) → synthesized pass
    //   Page "core": worker, outline, draft, L1-review (pass), L2-review (pass)
    //
    // Prefetch fires BEFORE review, consuming mock queue entries concurrently
    // with review calls. To avoid non-deterministic queue depletion, use
    // mockImplementation that routes reviewer calls (identified by system
    // prompt) separately from evidence/outline/draft calls.

    let overviewReviewsDone = 0;
    const nonReviewResponses = [
      mockResponse(JSON.stringify(wikiJson)),           // 1. Catalog
      mockResponse(workerOutput("overview")),           // 2. overview worker
      mockResponse(outlineOutput("overview")),          // 3. overview outline
      mockResponse(draftOutput("overview", "Overview", "README.md")), // 4. overview draft
      mockResponse(workerOutput("core")),               // 5. core worker (or prefetch)
      mockResponse(outlineOutput("core")),              // 6. core outline (or prefetch)
      mockResponse(draftOutput("core", "Core")),        // 7. core draft
    ];
    let nonReviewIdx = 0;

    mockGenerateText.mockImplementation((params: unknown) => {
      const opts = params as { system?: string } | undefined;
      const sys = opts?.system ?? "";
      const isReview = sys.includes("semantic reviewer") || sys.includes("quality reviewer");

      if (isReview && overviewReviewsDone < 2) {
        overviewReviewsDone++;
        return Promise.reject(new Error("LLM API rate limit"));
      }
      if (isReview) {
        return Promise.resolve(mockResponse(passReview));
      }

      // Non-review call: consume from ordered response list
      if (nonReviewIdx < nonReviewResponses.length) {
        return Promise.resolve(nonReviewResponses[nonReviewIdx++]);
      }
      // Fallback for any extra prefetch calls
      return Promise.resolve(mockResponse(workerOutput("prefetch-fallback")));
    });

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

    // Same scenario but with non-retryable auth errors for reviewer calls.
    // Uses mockImplementation to route reviewer calls separately from
    // evidence/outline/draft calls, avoiding prefetch queue races.

    let overviewReviewsDone = 0;
    const nonReviewResponses = [
      mockResponse(JSON.stringify(wikiJson)),           // 1. Catalog
      mockResponse(workerOutput("overview")),           // 2. overview worker
      mockResponse(outlineOutput("overview")),          // 3. overview outline
      mockResponse(draftOutput("overview", "Overview", "README.md")), // 4. overview draft
      mockResponse(workerOutput("core")),               // 5. core worker (or prefetch)
      mockResponse(outlineOutput("core")),              // 6. core outline (or prefetch)
      mockResponse(draftOutput("core", "Core")),        // 7. core draft
    ];
    let nonReviewIdx = 0;

    mockGenerateText.mockImplementation((params: unknown) => {
      const opts = params as { system?: string } | undefined;
      const sys = opts?.system ?? "";
      const isReview = sys.includes("semantic reviewer") || sys.includes("quality reviewer");

      if (isReview && overviewReviewsDone < 2) {
        overviewReviewsDone++;
        return Promise.reject(Object.assign(new Error("Unauthorized"), { statusCode: 401 }));
      }
      if (isReview) {
        return Promise.resolve(mockResponse(passReview));
      }

      if (nonReviewIdx < nonReviewResponses.length) {
        return Promise.resolve(nonReviewResponses[nonReviewIdx++]);
      }
      return Promise.resolve(mockResponse(workerOutput("prefetch-fallback")));
    });

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
