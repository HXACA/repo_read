import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { GenerationPipeline } from "../generation-pipeline.js";
import { StorageAdapter } from "../../storage/storage-adapter.js";
import { JobStateManager } from "../job-state.js";
import { EventReader } from "../../events/event-reader.js";
import type { WikiJson, PageMeta } from "../../types/generation.js";
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
  projectSlug: "fixture",
  repoRoot: "/tmp/repo",
  preset: "budget",
  language: "en",
  roles: {
    "main.author": {
      role: "main.author",
      primaryModel: "mock",
      fallbackModels: [],
      resolvedProvider: "mock",
      systemPromptTuningId: "claude",
    },
    "fork.worker": {
      role: "fork.worker",
      primaryModel: "mock",
      fallbackModels: [],
      resolvedProvider: "mock",
      systemPromptTuningId: "claude",
    },
    "fresh.reviewer": {
      role: "fresh.reviewer",
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
  summary: "A minimal fixture project for testing",
  reading_order: [
    {
      slug: "overview",
      title: "Project Overview",
      rationale: "Introduction",
      covered_files: ["README.md"],
      section: "Intro",
    },
    {
      slug: "main-module",
      title: "Main Module",
      rationale: "Core logic",
      covered_files: ["src/main.ts"],
      section: "Core",
    },
  ],
};

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

const workerOutput = (slug: string, file: string) =>
  JSON.stringify({
    directive: `Collect evidence for ${slug}`,
    findings: [`Found content in ${file}`],
    citations: [
      { kind: "file", target: file, locator: "1-5", note: "main content" },
    ],
    open_questions: [],
  });

const outlineOutput = (slug: string, file: string) =>
  JSON.stringify({
    sections: [
      {
        heading: `${slug} Overview`,
        key_points: [`${slug} introduction`],
        cite_from: [{ target: file, locator: "1-5" }],
      },
      {
        heading: `${slug} Details`,
        key_points: [`${slug} details`],
        cite_from: [{ target: file, locator: "1-5" }],
      },
    ],
  });

const REVIEW_PASS = JSON.stringify({
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

describe("pipeline golden fixture", () => {
  let tmpDir: string;
  let storage: StorageAdapter;
  let jobManager: JobStateManager;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rr-golden-"));

    // Create a minimal fixture repository
    await fs.writeFile(
      path.join(tmpDir, "README.md"),
      "# Fixture\nA test project.\n",
    );
    await fs.mkdir(path.join(tmpDir, "src"), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, "src", "main.ts"),
      "export function main() { return 1; }\n",
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

  it("produces correct file layout and metadata", async () => {
    const { generateText } = await import("ai");
    const mockGen = vi.mocked(generateText);

    // Budget preset (forkWorkers=1) call sequence:
    //   1. Catalog planner
    //   Per page: worker, outline, draft, review
    //   Total: 1 + 4 + 4 = 9 calls

    // Call 1: Catalog planner
    mockGen.mockResolvedValueOnce(mockResponse(JSON.stringify(WIKI)));

    // Page "overview": worker, outline, draft, review
    mockGen.mockResolvedValueOnce(
      mockResponse(workerOutput("overview", "README.md")),
    );
    mockGen.mockResolvedValueOnce(
      mockResponse(outlineOutput("overview", "README.md")),
    );
    mockGen.mockResolvedValueOnce(
      mockResponse(makeDraft("overview", "Project Overview", "README.md")),
    );
    mockGen.mockResolvedValueOnce(mockResponse(REVIEW_PASS));

    // Page "main-module": worker, outline, draft, review
    mockGen.mockResolvedValueOnce(
      mockResponse(workerOutput("main-module", "src/main.ts")),
    );
    mockGen.mockResolvedValueOnce(
      mockResponse(outlineOutput("main-module", "src/main.ts")),
    );
    mockGen.mockResolvedValueOnce(
      mockResponse(
        makeDraft("main-module", "Main Module", "src/main.ts"),
      ),
    );
    mockGen.mockResolvedValueOnce(mockResponse(REVIEW_PASS));

    const pipeline = new GenerationPipeline({
      storage,
      jobManager,
      config: CONFIG,
      model: {} as never,
      reviewerModel: {} as never,
      repoRoot: tmpDir,
      commitHash: "golden123",
    });

    const job = await jobManager.create("fixture", tmpDir, CONFIG);
    const result = await pipeline.run(job);

    expect(result.success).toBe(true);

    // --- GOLDEN ASSERTIONS ---

    // 1. Published version directory exists
    const versionDir = storage.paths.versionDir(
      "fixture",
      job.versionId,
    );
    const vDirExists = await fs
      .access(versionDir)
      .then(() => true)
      .catch(() => false);
    expect(vDirExists).toBe(true);

    // 2. wiki.json in published version
    const wiki = await storage.readJson<WikiJson>(
      storage.paths.versionWikiJson("fixture", job.versionId),
    );
    expect(wiki).not.toBeNull();
    expect(wiki!.reading_order).toHaveLength(2);
    expect(wiki!.reading_order[0].slug).toBe("overview");
    expect(wiki!.reading_order[1].slug).toBe("main-module");

    // 3. Page markdown files exist with expected content
    for (const slug of ["overview", "main-module"]) {
      const mdPath = storage.paths.versionPageMd(
        "fixture",
        job.versionId,
        slug,
      );
      const md = await fs.readFile(mdPath, "utf-8");
      expect(md).toContain("# ");
      expect(md).toContain("[cite:file:");
    }

    // 4. Page meta files exist with expected fields
    for (const slug of ["overview", "main-module"]) {
      const metaPath = storage.paths.versionPageMeta(
        "fixture",
        job.versionId,
        slug,
      );
      const meta = await storage.readJson<PageMeta>(metaPath);
      expect(meta).not.toBeNull();
      expect(meta!.status).toBe("validated");
      expect(meta!.commitHash).toBe("golden123");
      expect(meta!.slug).toBe(slug);
    }

    // 5. Citation files exist in published version
    for (const slug of ["overview", "main-module"]) {
      const citePath = storage.paths.versionCitationsJson(
        "fixture",
        job.versionId,
        slug,
      );
      const citeExists = await storage.exists(citePath);
      expect(citeExists).toBe(true);
    }

    // 6. Events ndjson has expected event types in order
    const reader = new EventReader(
      storage.paths.eventsNdjson("fixture", job.id),
    );
    const events = await reader.readAll();
    const types = events.map((e) => e.type);
    expect(types).toContain("job.started");
    expect(types).toContain("catalog.completed");
    expect(types).toContain("page.evidence_planned");
    expect(types).toContain("page.drafting");
    expect(types).toContain("page.reviewed");
    expect(types).toContain("page.validated");
    expect(types).toContain("job.completed");

    // Verify event ordering: job.started before catalog.completed
    expect(types.indexOf("job.started")).toBeLessThan(
      types.indexOf("catalog.completed"),
    );
    // catalog.completed before first page.drafting
    expect(types.indexOf("catalog.completed")).toBeLessThan(
      types.indexOf("page.drafting"),
    );
    // last page.validated before job.completed
    expect(types.lastIndexOf("page.validated")).toBeLessThan(
      types.indexOf("job.completed"),
    );

    // 7. Job state is completed with correct summary
    const finalJob = await jobManager.get("fixture", job.id);
    expect(finalJob).not.toBeNull();
    expect(finalJob!.status).toBe("completed");
    expect(finalJob!.summary.totalPages).toBe(2);
    expect(finalJob!.summary.succeededPages).toBe(2);

    // 8. Version JSON exists with correct page count
    const versionJsonPath = storage.paths.versionJson(
      "fixture",
      job.versionId,
    );
    const versionJson = await storage.readJson<{
      versionId: string;
      pageCount: number;
      commitHash: string;
    }>(versionJsonPath);
    expect(versionJson).not.toBeNull();
    expect(versionJson!.pageCount).toBe(2);
    expect(versionJson!.commitHash).toBe("golden123");
  }, 30_000);
});
