import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { GenerationPipeline } from "../generation-pipeline.js";
import { StorageAdapter } from "../../storage/storage-adapter.js";
import { JobStateManager } from "../job-state.js";
import type { WikiJson } from "../../types/generation.js";
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

const CONFIG: ResolvedConfig = {
  projectSlug: "proj",
  repoRoot: "/tmp/repo",
  preset: "budget",
  language: "en",
  roles: {
    "catalog": {
      role: "catalog",
      primaryModel: "mock",
      fallbackModels: [],
      resolvedProvider: "mock",
      systemPromptTuningId: "claude",
    },
    "outline": {
      role: "outline",
      primaryModel: "mock",
      fallbackModels: [],
      resolvedProvider: "mock",
      systemPromptTuningId: "claude",
    },
    "drafter": {
      role: "drafter",
      primaryModel: "mock",
      fallbackModels: [],
      resolvedProvider: "mock",
      systemPromptTuningId: "claude",
    },
    "worker": {
      role: "worker",
      primaryModel: "mock",
      fallbackModels: [],
      resolvedProvider: "mock",
      systemPromptTuningId: "claude",
    },
    "reviewer": {
      role: "reviewer",
      primaryModel: "mock",
      fallbackModels: [],
      resolvedProvider: "mock",
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

const WIKI: WikiJson = {
  summary: "A tiny fixture project",
  reading_order: [
    {
      slug: "overview",
      title: "Project Overview",
      rationale: "Introduction",
      covered_files: ["README.md"],
      section: "Intro",
    },
    {
      slug: "secondary",
      title: "Secondary Page",
      rationale: "Details",
      covered_files: ["src/index.ts"],
      section: "Details",
    },
  ],
};

function makeWorkerOutput(slug: string, file: string): string {
  return JSON.stringify({
    directive: `Collect evidence for ${slug}`,
    findings: [`Found content in ${file}`],
    citations: [
      { kind: "file", target: file, locator: "1-5", note: "main content" },
    ],
    open_questions: [],
  });
}

function makeOutlineOutput(slug: string, file: string): string {
  return JSON.stringify({
    sections: [
      {
        heading: `${slug} Overview`,
        key_points: [`${slug} introduction`],
        cite_from: [{ target: file, locator: "1-5" }],
      },
    ],
  });
}

function makeDraft(slug: string, title: string, file: string): string {
  return [
    `# ${title}`,
    "",
    `This is the ${slug} page [cite:file:${file}:1-5].`,
    "",
    "## Details",
    "",
    `More info about ${slug} [cite:file:${file}:1-5].`,
    "",
  ].join("\n");
}

const REVIEW_PASS = JSON.stringify({
  verdict: "pass",
  blockers: [],
  factual_risks: [],
  missing_evidence: [],
  scope_violations: [],
  suggested_revisions: [],
});

const mockResponse = (text: string) =>
  ({
    text,
    usage: { inputTokens: 200, outputTokens: 100 },
  }) as never;

describe("evidence / outline / publishedIndex persistence", () => {
  let tmpDir: string;
  let storage: StorageAdapter;
  let jobManager: JobStateManager;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rr-persist-"));

    await fs.writeFile(
      path.join(tmpDir, "README.md"),
      "# Fixture\nA test project.\n",
    );
    await fs.mkdir(path.join(tmpDir, "src"), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, "src", "index.ts"),
      "export const x = 1;\n",
    );

    storage = new StorageAdapter(tmpDir);
    await storage.initialize();
    jobManager = new JobStateManager(storage);

    vi.clearAllMocks();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("persists evidence, outline, and publishedIndex to disk", async () => {
    const { generateText } = await import("ai");
    const mockGen = vi.mocked(generateText);

    // Budget preset (forkWorkers=1) call sequence:
    //   1. Catalog planner
    //   Per page: worker, outline, draft, review
    //   Total: 1 + 4 + 4 = 9 calls

    // Call 1: Catalog planner
    mockGen.mockResolvedValueOnce(mockResponse(JSON.stringify(WIKI)));

    // Page "overview": worker, outline, draft, review
    mockGen.mockResolvedValueOnce(mockResponse(makeWorkerOutput("overview", "README.md")));
    mockGen.mockResolvedValueOnce(mockResponse(makeOutlineOutput("overview", "README.md")));
    mockGen.mockResolvedValueOnce(mockResponse(makeDraft("overview", "Project Overview", "README.md")));
    mockGen.mockResolvedValueOnce(mockResponse(REVIEW_PASS));

    // Page "secondary": worker, outline, draft, review
    mockGen.mockResolvedValueOnce(mockResponse(makeWorkerOutput("secondary", "src/index.ts")));
    mockGen.mockResolvedValueOnce(mockResponse(makeOutlineOutput("secondary", "src/index.ts")));
    mockGen.mockResolvedValueOnce(mockResponse(makeDraft("secondary", "Secondary Page", "src/index.ts")));
    mockGen.mockResolvedValueOnce(mockResponse(REVIEW_PASS));

    const pipeline = new GenerationPipeline({
      storage,
      jobManager,
      config: CONFIG,
      catalogModel: {} as never,
      outlineModel: {} as never,
      drafterModel: {} as never,
      workerModel: {} as never,
      reviewerModel: {} as never,
      repoRoot: tmpDir,
      commitHash: "persist123",
    });

    const job = await jobManager.create("proj", tmpDir, CONFIG);
    const result = await pipeline.run(job);

    expect(result.success).toBe(true);

    // 1. Evidence file exists with ledger field
    const evidencePath = storage.paths.evidenceJson("proj", job.id, "overview");
    const evidence = await storage.readJson<{ ledger: unknown[] }>(evidencePath);
    expect(evidence).not.toBeNull();
    expect(evidence!.ledger).toBeDefined();
    expect(Array.isArray(evidence!.ledger)).toBe(true);

    // 2. Outline file exists with sections field
    const outlinePath = storage.paths.outlineJson("proj", job.id, "overview");
    const outline = await storage.readJson<{ sections: unknown[] }>(outlinePath);
    expect(outline).not.toBeNull();
    expect(outline!.sections).toBeDefined();
    expect(Array.isArray(outline!.sections)).toBe(true);
    expect(outline!.sections.length).toBeGreaterThan(0);

    // 3. Published index exists as an array
    const indexPath = storage.paths.publishedIndexJson("proj", job.id);
    const index = await storage.readJson<unknown[]>(indexPath);
    expect(index).not.toBeNull();
    expect(Array.isArray(index)).toBe(true);
    expect(index!.length).toBeGreaterThan(0);
  }, 30_000);
});
