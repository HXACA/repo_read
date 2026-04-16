import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { GenerationPipeline } from "../generation-pipeline.js";
import { StorageAdapter } from "../../storage/storage-adapter.js";
import { JobStateManager } from "../job-state.js";
import type { ResolvedConfig } from "../../types/config.js";
import { getQualityProfile } from "../../config/quality-profile.js";

// Force L1 verification so exactly 1 reviewer LLM call fires per review —
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
  qualityProfile: {
    // Override maxEvidenceAttempts to keep the re-collection test's intent
    // alive after the cap was introduced. Budget's default cap is 1, which
    // would suppress the very re-collection this test is asserting.
    ...getQualityProfile("budget"),
    maxEvidenceAttempts: 2,
  },
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
    //     2. worker (attempt 0)
    //     3. outline planner (attempt 0)
    //     4. draft (attempt 0)
    //     5. review → revise with factual_risks
    //     6. worker (attempt 1 — re-collected due to factual_risks)
    //     7. outline planner (attempt 1 — re-planned due to new evidence)
    //     8. draft (attempt 1)
    //     9. review → pass
    //   Page "core":
    //     10. worker
    //     11. outline planner
    //     12. draft
    //     13. review → pass
    // Total = 13

    // Prefetch fires BEFORE review, consuming mock queue entries concurrently.
    // Use mockImplementation to route reviewer calls (identified by system
    // prompt) separately from evidence/outline/draft calls, avoiding races.

    let reviewCallCount = 0;
    const nonReviewResponses = [
      mockResponse(JSON.stringify(wikiJson)),           // 1. Catalog
      mockResponse(workerOutput("overview")),           // 2. overview worker (attempt 0)
      mockResponse(outlineOutput("overview")),          // 3. overview outline (attempt 0)
      mockResponse(draftOutput("overview", "Overview", "README.md")), // 4. overview draft (attempt 0)
      // review (attempt 0) → handled by mockImplementation below
      mockResponse(workerOutput("overview")),           // 5. overview worker (attempt 1, re-collect)
      mockResponse(outlineOutput("overview")),          // 6. overview outline (attempt 1, re-plan)
      mockResponse(draftOutput("overview", "Overview", "README.md")), // 7. overview draft (attempt 1)
      // review (attempt 1) → handled by mockImplementation below
      mockResponse(workerOutput("core")),               // 8. core worker (or prefetch)
      mockResponse(outlineOutput("core")),              // 9. core outline (or prefetch)
      mockResponse(draftOutput("core", "Core")),        // 10. core draft
      // review (core) → handled by mockImplementation below
    ];
    let nonReviewIdx = 0;

    mockGenerateText.mockImplementation((params: unknown) => {
      const opts = params as { system?: string } | undefined;
      const sys = opts?.system ?? "";
      const isReview = sys.includes("semantic reviewer") || sys.includes("quality reviewer");

      if (isReview) {
        reviewCallCount++;
        if (reviewCallCount === 1) {
          // First review (overview attempt 0) → revise with factual risks
          return Promise.resolve(mockResponse(reviseWithFactualRisks));
        }
        // All subsequent reviews → pass
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

    expect(result.success).toBe(true);
    expect(result.job.status).toBe("completed");
    expect(result.job.summary.totalPages).toBe(2);
    expect(result.job.summary.succeededPages).toBe(2);

    // 13 base calls: 1 catalog + (4+4) overview attempts + 4 core.
    // A run without re-collection would only have 9 calls (no re-worker/re-outline).
    // Prefetch fires before review, adding up to 2 background calls (worker + outline
    // for the next page), so total is 13-15.
    expect(mockGenerateText.mock.calls.length).toBeGreaterThanOrEqual(13);
    expect(mockGenerateText.mock.calls.length).toBeLessThanOrEqual(16);
  });

  it("stops re-collecting evidence once qp.maxEvidenceAttempts is reached", async () => {
    const { generateText } = await import("ai");
    const mockGenerateText = vi.mocked(generateText);

    // Config: maxRevisionAttempts=2 (3 draft rounds: 0,1,2),
    //         maxEvidenceAttempts=2 (cap evidence at 2 total).
    // Reviewer flags missing_evidence on every review.
    // Expected: worker/outline for the first page run twice (attempts 0, 1),
    // skipped on attempt 2.
    const capConfig: ResolvedConfig = {
      ...mockConfig,
      qualityProfile: {
        ...getQualityProfile("budget"),
        maxRevisionAttempts: 2,
        maxEvidenceAttempts: 2,
      },
    };

    // Two pages so catalog min=2 is satisfied. Only the first page exercises
    // the revision loop; the second page passes on its first review.
    const twoPageWiki = {
      summary: "Test project",
      reading_order: [
        { slug: "overview", title: "Overview", rationale: "r1", covered_files: ["README.md"] },
        { slug: "core", title: "Core", rationale: "r2", covered_files: ["src/index.ts"] },
      ],
    };

    // Count worker calls (evidence-collection calls) by matching the worker's
    // system prompt. See `packages/core/src/generation/fork-worker-prompt.ts`.
    let workerCallCount = 0;
    let reviewCallCount = 0;

    // Non-worker, non-review calls consume from this ordered queue.
    const orderedResponses = [
      mockResponse(JSON.stringify(twoPageWiki)),                      // catalog
      mockResponse(outlineOutput("overview")),                        // outline a0
      mockResponse(draftOutput("overview", "Overview", "README.md")), // draft a0
      mockResponse(outlineOutput("overview")),                        // outline a1
      mockResponse(draftOutput("overview", "Overview", "README.md")), // draft a1
      mockResponse(outlineOutput("overview")),                        // outline a2 (fallback if cap doesn't fire)
      mockResponse(draftOutput("overview", "Overview", "README.md")), // draft a2
      mockResponse(outlineOutput("core")),                            // core outline
      mockResponse(draftOutput("core", "Core")),                      // core draft
    ];
    let orderedIdx = 0;

    const reviseWithMissingEvidence = JSON.stringify({
      verdict: "revise",
      blockers: [],
      factual_risks: [],
      missing_evidence: ["need more evidence"],
      scope_violations: [],
      suggested_revisions: [],
    });

    mockGenerateText.mockImplementation((params: unknown) => {
      const opts = params as { system?: string } | undefined;
      const sys = opts?.system ?? "";
      const isReview = sys.includes("semantic reviewer") || sys.includes("quality reviewer");
      // Workers introduce themselves with `You are "worker"` — see fork-worker-prompt.ts.
      const isWorker = sys.includes("You are \"worker\"");

      if (isReview) {
        reviewCallCount++;
        // User messages target either "overview" or "core"; route the response
        // accordingly. This is more robust than a call-count heuristic when
        // the reviewer does multiple internal steps.
        const userMsg = JSON.stringify((params as { messages?: unknown })?.messages ?? "");
        if (userMsg.includes("core")) {
          return Promise.resolve(mockResponse(passReview));
        }
        return Promise.resolve(mockResponse(reviseWithMissingEvidence));
      }
      if (isWorker) {
        workerCallCount++;
        return Promise.resolve(mockResponse(workerOutput("worker")));
      }
      if (orderedIdx < orderedResponses.length) {
        return Promise.resolve(orderedResponses[orderedIdx++]);
      }
      return Promise.resolve(mockResponse(outlineOutput("fallback")));
    });

    const pipeline = new GenerationPipeline({
      storage,
      jobManager,
      config: capConfig,
      catalogModel: {} as never,
      outlineModel: {} as never,
      drafterModel: {} as never,
      workerModel: {} as never,
      reviewerModel: {} as never,
      repoRoot: tmpDir,
      commitHash: "abc123",
    });

    const job = await jobManager.create("proj-cap", tmpDir, capConfig);
    const result = await pipeline.run(job);

    expect(result.success).toBe(true);

    // Reviewer may emit multiple internal calls per verify; the key check is
    // that some reviews happened.
    expect(reviewCallCount).toBeGreaterThan(0);

    // Evidence workers per page:
    //   - overview attempt 0: 1 (initial, counter=1)
    //   - overview attempt 1: 1 (re-collect, counter=2 hits cap)
    //   - overview attempt 2: 0 with cap / 1 without cap
    //   - core: 1 (either inline or prefetched — prefetch also calls worker)
    // With cap honored: 2 (overview) + 1 (core) = 3
    // Without cap: 3 (overview) + 1 (core) = 4
    expect(workerCallCount).toBe(3);
  });
});
