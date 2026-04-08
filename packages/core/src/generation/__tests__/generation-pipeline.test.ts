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

vi.mock("ai", () => ({
  generateText: vi.fn(),
  jsonSchema: vi.fn((s: unknown) => s),
}));

const mockConfig: ResolvedConfig = {
  projectSlug: "proj",
  repoRoot: "/tmp/repo",
  preset: "quality",
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

    // Call 1: Catalog planner
    mockGenerateText.mockResolvedValueOnce({
      text: JSON.stringify(wikiJson),
      usage: { inputTokens: 500, outputTokens: 300 },
    } as never);

    // Call 2: Draft page "overview"
    mockGenerateText.mockResolvedValueOnce({
      text: draftOutput("overview", "Overview"),
      usage: { inputTokens: 500, outputTokens: 300 },
    } as never);

    // Call 3: Review page "overview"
    mockGenerateText.mockResolvedValueOnce({
      text: passReview,
      usage: { inputTokens: 300, outputTokens: 100 },
    } as never);

    // Call 4: Draft page "core"
    mockGenerateText.mockResolvedValueOnce({
      text: draftOutput("core", "Core"),
      usage: { inputTokens: 500, outputTokens: 300 },
    } as never);

    // Call 5: Review page "core"
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
});
