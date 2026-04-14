import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import {
  StorageAdapter,
  ProjectModel,
  JobStateManager,
  GenerationPipeline,
  EventReader,
} from "../index.js";
import type { WikiJson, ResolvedConfig, VersionJson } from "../index.js";
import { getQualityProfile } from "../config/quality-profile.js";

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

// Use budget preset: forkWorkers=1 short-circuits planner LLM call
const mockConfig: ResolvedConfig = {
  projectSlug: "mini-ts-app",
  repoRoot: "/tmp",
  preset: "budget",
  language: "zh",
  roles: {
    "catalog": { role: "catalog", primaryModel: "claude-sonnet-4-6", fallbackModels: [], resolvedProvider: "anthropic", systemPromptTuningId: "claude" },
    "outline": { role: "outline", primaryModel: "claude-sonnet-4-6", fallbackModels: [], resolvedProvider: "anthropic", systemPromptTuningId: "claude" },
    "drafter": { role: "drafter", primaryModel: "claude-sonnet-4-6", fallbackModels: [], resolvedProvider: "anthropic", systemPromptTuningId: "claude" },
    "worker": { role: "worker", primaryModel: "claude-haiku-4-5-20251001", fallbackModels: [], resolvedProvider: "anthropic", systemPromptTuningId: "claude" },
    "reviewer": { role: "reviewer", primaryModel: "claude-sonnet-4-6", fallbackModels: [], resolvedProvider: "anthropic", systemPromptTuningId: "claude" },
  },
  providers: [],
  retrieval: { maxParallelReadsPerPage: 5, maxReadWindowLines: 500, allowControlledBash: true },
  qualityProfile: getQualityProfile("budget"),
};

const wikiJson: WikiJson = {
  summary: "A tiny TypeScript app with greeting and utility functions",
  reading_order: [
    { slug: "overview", title: "Project Overview", rationale: "Start here", covered_files: ["README.md", "package.json"] },
    { slug: "core-functions", title: "Core Functions", rationale: "Main code", covered_files: ["src/index.ts"] },
    { slug: "utilities", title: "Utility Functions", rationale: "Helper code", covered_files: ["src/utils.ts"] },
  ],
};

function draftOutput(slug: string, title: string, coveredFiles: string[]): string {
  const citedFile = coveredFiles[0];
  return `# ${title}

This page covers the ${slug} section of the mini TypeScript application. The implementation demonstrates clean TypeScript patterns with proper type annotations and modular design.

The codebase follows modern ESM conventions with explicit exports and a clear module boundary between core functions and utilities.

[cite:file:${citedFile}:1-10]

\`\`\`json
{
  "summary": "Covers ${title.toLowerCase()} with evidence from the repository",
  "citations": [{ "kind": "file", "target": "${citedFile}", "locator": "1-10", "note": "Main module" }],
  "related_pages": []
}
\`\`\``;
}

const passReview = JSON.stringify({
  verdict: "pass",
  blockers: [],
  factual_risks: [],
  missing_evidence: [],
  scope_violations: [],
  suggested_revisions: [],
});

const workerOutput = (slug: string, coveredFiles: string[]) =>
  JSON.stringify({
    directive: `Collect evidence for ${slug}`,
    findings: [`Finding from ${slug}`],
    citations: [
      { kind: "file", target: coveredFiles[0], locator: "1-10", note: "entry" },
    ],
    open_questions: [],
  });

describe("E2E Pipeline", () => {
  let tmpDir: string;
  let storage: StorageAdapter;
  let jobManager: JobStateManager;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "reporead-e2e-"));
    storage = new StorageAdapter(tmpDir);
    await storage.initialize();

    // Create project
    const projectModel = new ProjectModel(storage);
    await projectModel.create({
      projectSlug: "mini-ts-app",
      repoRoot: tmpDir,
      branch: "main",
    });

    jobManager = new JobStateManager(storage);
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("runs init -> generate -> verify published output", async () => {
    const { generateText } = await import("ai");
    const mock = vi.mocked(generateText);

    // Catalog
    mock.mockResolvedValueOnce({ text: JSON.stringify(wikiJson), usage: { inputTokens: 500, outputTokens: 300 } } as never);

    // 3 pages x (worker + outline + draft) = 9 calls
    // (budget preset forkWorkers=1, planner fast-path skips LLM)
    // Review mock is NOT needed: budget preset + low complexity → fast lane → L0
    // (deterministic-only verification, no LLM call)
    for (const page of wikiJson.reading_order) {
      mock.mockResolvedValueOnce({ text: workerOutput(page.slug, page.covered_files), usage: { inputTokens: 200, outputTokens: 100 } } as never);
      // Outline planner
      mock.mockResolvedValueOnce({ text: JSON.stringify({
        sections: [
          { heading: `${page.title} 概述`, key_points: ["overview"], cite_from: [{ target: page.covered_files[0], locator: "1-10" }] },
          { heading: `${page.title} 细节`, key_points: ["details"], cite_from: [{ target: page.covered_files[0], locator: "1-10" }] },
        ],
      }), usage: { inputTokens: 100, outputTokens: 80 } } as never);
      mock.mockResolvedValueOnce({ text: draftOutput(page.slug, page.title, page.covered_files), usage: { inputTokens: 500, outputTokens: 300 } } as never);
    }

    const job = await jobManager.create("mini-ts-app", tmpDir, mockConfig);

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
      commitHash: "e2e-test-hash",
    });

    const result = await pipeline.run(job);

    // Verify pipeline succeeded
    expect(result.success).toBe(true);
    expect(result.job.status).toBe("completed");
    expect(result.job.summary.totalPages).toBe(3);
    expect(result.job.summary.succeededPages).toBe(3);

    // Verify published version exists
    const versionJson = await storage.readJson<VersionJson>(
      storage.paths.versionJson("mini-ts-app", result.job.versionId),
    );
    expect(versionJson).not.toBeNull();
    expect(versionJson!.pageCount).toBe(3);
    expect(versionJson!.commitHash).toBe("e2e-test-hash");

    // Verify wiki.json exists
    const publishedWiki = await storage.readJson<WikiJson>(
      storage.paths.versionWikiJson("mini-ts-app", result.job.versionId),
    );
    expect(publishedWiki).not.toBeNull();
    expect(publishedWiki!.reading_order).toHaveLength(3);

    // Verify all page markdown exists
    for (const page of wikiJson.reading_order) {
      const mdPath = storage.paths.versionPageMd("mini-ts-app", result.job.versionId, page.slug);
      const md = await fs.readFile(mdPath, "utf-8");
      expect(md).toContain(`# ${page.title}`);
    }

    // Verify events were recorded
    const eventReader = new EventReader(storage.paths.eventsNdjson("mini-ts-app", job.id));
    const events = await eventReader.readAll();
    const types = events.map((e) => e.type);

    expect(types).toContain("job.started");
    expect(types).toContain("catalog.completed");
    expect(types.filter((t) => t === "page.drafting")).toHaveLength(3);
    expect(types.filter((t) => t === "page.reviewed")).toHaveLength(3);
    expect(types.filter((t) => t === "page.validated")).toHaveLength(3);
    expect(types).toContain("job.completed");

    // Verify current.json updated
    const current = await storage.readJson<{ versionId: string }>(storage.paths.currentJson);
    expect(current).not.toBeNull();
    expect(current!.versionId).toBe(result.job.versionId);
  });
});
