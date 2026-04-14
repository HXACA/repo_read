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
});
