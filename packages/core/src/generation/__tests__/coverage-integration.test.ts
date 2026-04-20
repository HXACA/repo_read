import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { GenerationPipeline } from "../generation-pipeline.js";
import { StorageAdapter } from "../../storage/storage-adapter.js";
import { JobStateManager } from "../job-state.js";
import type { ResolvedConfig } from "../../types/config.js";
import { getQualityProfile, type QualityProfile } from "../../config/quality-profile.js";

// Force L1 so reviewer runs deterministically (1 LLM call per review)
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
      const safe = (fn: (r: any) => any) => {
        const q = p.then(fn);
        q.catch(() => {});
        return q;
      };
      return {
        text: safe((r) => r?.text ?? ""),
        finishReason: safe((r) => r?.finishReason ?? "stop"),
        usage: safe((r) => r?.usage ?? {}),
        toolCalls: safe((r) => r?.toolCalls ?? []),
        toolResults: safe((r) => r?.toolResults ?? []),
        steps: safe((r) => r?.steps ?? []),
        response: safe((r) => r?.response ?? {}),
        fullStream: (async function* () {
          const r = await p;
          if (r?.text) yield { type: "text-delta", textDelta: r.text };
        })(),
      };
    }),
    jsonSchema: vi.fn((s: unknown) => s),
    stepCountIs: vi.fn(() => () => false),
  };
});

function makeConfig(overrides: Partial<QualityProfile> = {}): ResolvedConfig {
  return {
    projectSlug: "proj",
    repoRoot: "/tmp/repo",
    preset: "budget",
    language: "zh",
    roles: {
      catalog: {
        role: "catalog",
        primaryModel: "m",
        fallbackModels: [],
        resolvedProvider: "anthropic",
        systemPromptTuningId: "claude",
      },
      outline: {
        role: "outline",
        primaryModel: "m",
        fallbackModels: [],
        resolvedProvider: "anthropic",
        systemPromptTuningId: "claude",
      },
      drafter: {
        role: "drafter",
        primaryModel: "m",
        fallbackModels: [],
        resolvedProvider: "anthropic",
        systemPromptTuningId: "claude",
      },
      worker: {
        role: "worker",
        primaryModel: "m",
        fallbackModels: [],
        resolvedProvider: "anthropic",
        systemPromptTuningId: "claude",
      },
      reviewer: {
        role: "reviewer",
        primaryModel: "m",
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
      ...getQualityProfile("budget"),
      // Pin pageConcurrency=1 explicitly — the test's mockAi feed order
      // assumes serial page processing. If someone bumps the budget preset
      // default, this test would become flaky without this lock.
      pageConcurrency: 1,
      ...overrides,
    },
  };
}

const mockResponse = (text: string) =>
  ({
    text,
    usage: { inputTokens: 100, outputTokens: 50 },
  }) as never;

// ---- Fixtures ----

const twoPageWiki = {
  summary: "Test project",
  reading_order: [
    {
      slug: "overview",
      title: "Overview",
      rationale: "r1",
      covered_files: ["README.md"],
    },
    {
      slug: "core",
      title: "Core",
      rationale: "r2",
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

const workerOutput = (slug: string, file = "src/index.ts") =>
  JSON.stringify({
    directive: `Collect evidence for ${slug}`,
    findings: [`${slug} finding — defines Foo`],
    citations: [
      {
        kind: "file",
        target: file,
        locator: "1-10",
        note: `defines ${slug} Foo`,
      },
    ],
    open_questions: [],
  });

const outlineOutput = (_slug: string, mechIds: string[] = []) =>
  JSON.stringify({
    sections: [
      {
        heading: "概述",
        key_points: ["overview"],
        cite_from: [{ target: "src/index.ts", locator: "1-10" }],
        covers_mechanisms: mechIds,
      },
      {
        heading: "细节",
        key_points: ["details"],
        cite_from: [{ target: "src/index.ts", locator: "1-10" }],
        covers_mechanisms: [],
      },
    ],
    out_of_scope_mechanisms: [],
  });

const makePassReview = (extras: Record<string, unknown> = {}) =>
  JSON.stringify({
    verdict: "pass",
    blockers: [],
    factual_risks: [],
    missing_evidence: [],
    scope_violations: [],
    missing_coverage: [],
    suggested_revisions: [],
    ...extras,
  });

// Heuristic role detection for routing mocked LLM calls.
function detectRole(
  sys: string,
): "catalog" | "worker" | "outline" | "drafter" | "reviewer" | "unknown" {
  if (
    sys.includes("semantic reviewer") ||
    sys.includes("quality reviewer")
  ) {
    return "reviewer";
  }
  if (sys.includes('You are "worker"')) return "worker";
  if (sys.includes("documentation outline planner")) return "outline";
  if (sys.includes('You are "drafter"')) return "drafter";
  if (sys.includes("catalog") || sys.includes("wiki catalog")) return "catalog";
  return "unknown";
}

describe("coverage enforcement integration", () => {
  let tmpDir: string;
  let storage: StorageAdapter;
  let jobManager: JobStateManager;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "reporead-coverage-"),
    );
    storage = new StorageAdapter(tmpDir);
    await storage.initialize();
    jobManager = new JobStateManager(storage);
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("off: pipeline behaves equivalently to legacy; throughput.coverageAudit undefined", async () => {
    const { generateText } = await import("ai");
    const mockGenerateText = vi.mocked(generateText);

    // budget preset defaults coverageEnforcement to "off"; no override needed
    const config = makeConfig();

    mockGenerateText.mockImplementation((params: unknown) => {
      const opts = params as { system?: string; messages?: unknown } | undefined;
      const role = detectRole(opts?.system ?? "");
      const msgText = JSON.stringify(opts?.messages ?? "");
      const isCore =
        msgText.includes("src/index.ts") ||
        msgText.includes("Core") ||
        msgText.includes("\"core\"");
      const slug = isCore ? "core" : "overview";
      const title = slug === "overview" ? "Overview" : "Core";
      const file = slug === "overview" ? "README.md" : "src/index.ts";

      switch (role) {
        case "catalog":
          return Promise.resolve(mockResponse(JSON.stringify(twoPageWiki)));
        case "worker":
          return Promise.resolve(mockResponse(workerOutput(slug, file)));
        case "outline":
          return Promise.resolve(mockResponse(outlineOutput(slug)));
        case "drafter":
          return Promise.resolve(mockResponse(draftOutput(slug, title, file)));
        case "reviewer":
          return Promise.resolve(mockResponse(makePassReview()));
        default:
          return Promise.resolve(mockResponse(JSON.stringify(twoPageWiki)));
      }
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
      commitHash: "abc",
    });

    const job = await jobManager.create("proj", tmpDir, config);
    const result = await pipeline.run(job);

    expect(result.success).toBe(true);

    const throughputPath = path.join(
      storage.paths.jobDir("proj", job.id),
      "throughput.json",
    );
    const metrics = JSON.parse(await fs.readFile(throughputPath, "utf-8"));
    expect(metrics.coverageAudit).toBeUndefined();
    expect(metrics.pages[0].coverage).toBeUndefined();
    expect(metrics.pages[1].coverage).toBeUndefined();
  });

  it("warn: reviewer returns missing_coverage but pipeline does NOT revise", async () => {
    const { generateText } = await import("ai");
    const mockGenerateText = vi.mocked(generateText);

    const config = makeConfig({ coverageEnforcement: "warn" });

    let reviewCalls = 0;

    mockGenerateText.mockImplementation((params: unknown) => {
      const opts = params as { system?: string; messages?: unknown } | undefined;
      const role = detectRole(opts?.system ?? "");
      const msgText = JSON.stringify(opts?.messages ?? "");
      const isCore =
        msgText.includes("src/index.ts") ||
        msgText.includes("Core") ||
        msgText.includes("\"core\"");
      const slug = isCore ? "core" : "overview";
      const title = slug === "overview" ? "Overview" : "Core";
      const file = slug === "overview" ? "README.md" : "src/index.ts";

      switch (role) {
        case "catalog":
          return Promise.resolve(mockResponse(JSON.stringify(twoPageWiki)));
        case "worker":
          return Promise.resolve(mockResponse(workerOutput(slug, file)));
        case "outline":
          return Promise.resolve(
            mockResponse(outlineOutput(slug, [`file:${file}`])),
          );
        case "drafter":
          return Promise.resolve(mockResponse(draftOutput(slug, title, file)));
        case "reviewer": {
          reviewCalls++;
          // warn mode: reviewer flags missing_coverage, but this should NOT
          // trigger a re-draft. Verdict stays "pass" so the pipeline exits
          // the revision loop immediately.
          return Promise.resolve(
            mockResponse(
              JSON.stringify({
                verdict: "pass",
                blockers: [],
                factual_risks: [],
                missing_evidence: [],
                scope_violations: [],
                missing_coverage: [`file:${file}`],
                suggested_revisions: [],
              }),
            ),
          );
        }
        default:
          return Promise.resolve(mockResponse(JSON.stringify(twoPageWiki)));
      }
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
      commitHash: "abc",
    });

    const job = await jobManager.create("proj", tmpDir, config);
    const result = await pipeline.run(job);

    expect(result.success).toBe(true);
    // warn mode: exactly one review per page; must NOT trigger any revision
    // from the coverage branch because `hasCoverageGap` is strict-gated.
    expect(reviewCalls).toBe(2);

    const throughputPath = path.join(
      storage.paths.jobDir("proj", job.id),
      "throughput.json",
    );
    const metrics = JSON.parse(await fs.readFile(throughputPath, "utf-8"));
    // coverage audit is populated because enforcement != "off"
    expect(metrics.coverageAudit).toBeDefined();
    expect(metrics.coverageAudit.pagesWithCoverageGap.length).toBeGreaterThan(0);
    // warn mode: coverageDrivenRevisions must stay at 0 because
    // hasCoverageGap is gated on `strict`. Any retries observed come from
    // the generic verdict=revise path, not from the coverage branch.
    for (const p of metrics.pages) {
      expect(p.coverage).toBeDefined();
      expect(p.coverage.coverageDrivenRevisions).toBe(0);
    }
  });

  it("strict happy: first review flags missing_coverage, revision covers it", async () => {
    const { generateText } = await import("ai");
    const mockGenerateText = vi.mocked(generateText);

    // Use balanced preset (maxRevisionAttempts=2) and enable strict coverage.
    const config = makeConfig({
      ...getQualityProfile("balanced"),
      coverageEnforcement: "strict",
    });

    let reviewCalls = 0;
    const slugReviewCounts: Record<string, number> = { overview: 0, core: 0 };

    mockGenerateText.mockImplementation((params: unknown) => {
      const opts = params as { system?: string; messages?: unknown } | undefined;
      const role = detectRole(opts?.system ?? "");
      const msgText = JSON.stringify(opts?.messages ?? "");
      const isCore =
        msgText.includes("src/index.ts") ||
        msgText.includes("Core") ||
        msgText.includes("\"core\"");
      const slug = isCore ? "core" : "overview";
      const title = slug === "overview" ? "Overview" : "Core";
      const file = slug === "overview" ? "README.md" : "src/index.ts";

      switch (role) {
        case "catalog":
          return Promise.resolve(mockResponse(JSON.stringify(twoPageWiki)));
        case "worker":
          return Promise.resolve(mockResponse(workerOutput(slug, file)));
        case "outline":
          return Promise.resolve(
            mockResponse(outlineOutput(slug, [`file:${file}`])),
          );
        case "drafter":
          return Promise.resolve(mockResponse(draftOutput(slug, title, file)));
        case "reviewer": {
          reviewCalls++;
          slugReviewCounts[slug] = (slugReviewCounts[slug] ?? 0) + 1;
          // First review for overview: revise with missing_coverage.
          // Second review (or any other page): pass with no coverage gap.
          if (slug === "overview" && slugReviewCounts.overview === 1) {
            return Promise.resolve(
              mockResponse(
                JSON.stringify({
                  verdict: "revise",
                  blockers: [],
                  factual_risks: [],
                  missing_evidence: [],
                  scope_violations: [],
                  missing_coverage: [`file:${file}`],
                  suggested_revisions: [],
                }),
              ),
            );
          }
          return Promise.resolve(mockResponse(makePassReview()));
        }
        default:
          return Promise.resolve(mockResponse(JSON.stringify(twoPageWiki)));
      }
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
      commitHash: "abc",
    });

    const job = await jobManager.create("proj", tmpDir, config);
    const result = await pipeline.run(job);

    expect(result.success).toBe(true);
    expect(reviewCalls).toBeGreaterThanOrEqual(3); // overview x2 + core x1

    const throughputPath = path.join(
      storage.paths.jobDir("proj", job.id),
      "throughput.json",
    );
    const metrics = JSON.parse(await fs.readFile(throughputPath, "utf-8"));

    const overviewRecord = metrics.pages.find(
      (p: { pageSlug: string }) => p.pageSlug === "overview",
    );
    expect(overviewRecord.coverage).toBeDefined();
    expect(overviewRecord.coverage.coverageDrivenRevisions).toBe(1);
    expect(overviewRecord.coverage.unresolvedMissingCoverage).toBe(0);

    // Job-wide audit: no page should remain with a coverage gap
    expect(metrics.coverageAudit).toBeDefined();
    expect(metrics.coverageAudit.pagesWithCoverageGap).not.toContain("overview");
  });

  it("strict cap-exhausted: page published with pageMeta.coverageBlockers", async () => {
    const { generateText } = await import("ai");
    const mockGenerateText = vi.mocked(generateText);

    // budget preset: maxRevisionAttempts=1 → 1 initial draft + 1 revision.
    const config = makeConfig({ coverageEnforcement: "strict" });

    const slugReviewCounts: Record<string, number> = { overview: 0, core: 0 };

    mockGenerateText.mockImplementation((params: unknown) => {
      const opts = params as { system?: string; messages?: unknown } | undefined;
      const role = detectRole(opts?.system ?? "");
      const msgText = JSON.stringify(opts?.messages ?? "");
      const isCore =
        msgText.includes("src/index.ts") ||
        msgText.includes("Core") ||
        msgText.includes("\"core\"");
      const slug = isCore ? "core" : "overview";
      const title = slug === "overview" ? "Overview" : "Core";
      const file = slug === "overview" ? "README.md" : "src/index.ts";

      switch (role) {
        case "catalog":
          return Promise.resolve(mockResponse(JSON.stringify(twoPageWiki)));
        case "worker":
          return Promise.resolve(mockResponse(workerOutput(slug, file)));
        case "outline":
          return Promise.resolve(
            mockResponse(outlineOutput(slug, [`file:${file}`])),
          );
        case "drafter":
          return Promise.resolve(mockResponse(draftOutput(slug, title, file)));
        case "reviewer": {
          slugReviewCounts[slug] = (slugReviewCounts[slug] ?? 0) + 1;
          // Overview: always return missing_coverage (cap exhausts at 2 reviews).
          // Core: pass.
          if (slug === "overview") {
            return Promise.resolve(
              mockResponse(
                JSON.stringify({
                  verdict: "revise",
                  blockers: [],
                  factual_risks: [],
                  missing_evidence: [],
                  scope_violations: [],
                  missing_coverage: ["file:README.md"],
                  suggested_revisions: [],
                }),
              ),
            );
          }
          return Promise.resolve(mockResponse(makePassReview()));
        }
        default:
          return Promise.resolve(mockResponse(JSON.stringify(twoPageWiki)));
      }
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
      commitHash: "abc",
    });

    const job = await jobManager.create("proj", tmpDir, config);
    const result = await pipeline.run(job);

    expect(result.success).toBe(true);

    // Overview should be published with coverageBlockers recorded in pageMeta.
    // After publish the draft dir is renamed to versionDir.
    const metaPath = path.join(
      storage.paths.versionDir("proj", job.versionId),
      "pages",
      "overview.meta.json",
    );
    const meta = JSON.parse(await fs.readFile(metaPath, "utf-8"));
    expect(meta.coverageBlockers).toEqual(["file:README.md"]);
    expect(meta.status).toBe("validated");

    const throughputPath = path.join(
      storage.paths.jobDir("proj", job.id),
      "throughput.json",
    );
    const metrics = JSON.parse(await fs.readFile(throughputPath, "utf-8"));
    expect(metrics.coverageAudit.pagesWithCoverageGap).toContain("overview");
  });
});
