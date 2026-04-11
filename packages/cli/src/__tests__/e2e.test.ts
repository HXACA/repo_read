import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

// Mock ai module before any imports. The vitest.config.ts alias ensures
// "ai" resolves to the same physical module that @reporead/core uses,
// so this single vi.mock intercepts all generateText calls.
vi.mock("ai", () => {
  const generateText = vi.fn();
  return {
    generateText,
    streamText: vi.fn((...args: unknown[]) => {
      const q = generateText(...args).catch(() => ({}));
      return {
        text: q.then((r: any) => r?.text ?? ""),
        finishReason: q.then((r: any) => r?.finishReason ?? "stop"),
        usage: q.then((r: any) => r?.usage ?? {}),
        toolCalls: q.then((r: any) => r?.toolCalls ?? []),
        toolResults: q.then((r: any) => r?.toolResults ?? []),
        steps: q.then((r: any) => r?.steps ?? []),
        response: q.then((r: any) => r?.response ?? {}),
      };
    }),
    jsonSchema: vi.fn((s: unknown) => s),
    stepCountIs: vi.fn(() => () => false),
  };
});

// Mock createModelForRole so it returns a dummy model string instead of
// trying to instantiate real provider SDKs (which need API keys).
vi.mock("@reporead/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@reporead/core")>();
  return {
    ...actual,
    createModelForRole: vi.fn(() => "mock-model"),
  };
});

import { runInit } from "../commands/init.js";
import { runGenerate } from "../commands/generate.js";
import { runDoctor } from "../commands/doctor.js";

// --- Reusable mock data ---

/** Wiki plan with 2 pages (catalog validator requires >= 2). */
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

/** Draft markdown with inline citations (extractMetadataFromMarkdown parses these). */
const draftMd = (slug: string, title: string, file: string) =>
  [
    `# ${title}`,
    "",
    `This is the ${slug} page content [cite:file:${file}:1-2].`,
    "",
    `## Details`,
    "",
    `More details about ${slug} [cite:file:${file}:1-2].`,
  ].join("\n");

const workerOutput = (file: string) =>
  JSON.stringify({
    directive: "collect",
    findings: [`Found ${file}`],
    citations: [{ kind: "file", target: file, locator: "1-2" }],
    open_questions: [],
  });

const outlineOutput = (file: string) =>
  JSON.stringify({
    sections: [
      {
        heading: "Overview",
        key_points: ["overview"],
        cite_from: [{ target: file, locator: "1-2" }],
      },
      {
        heading: "Details",
        key_points: ["details"],
        cite_from: [{ target: file, locator: "1-2" }],
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

describe("CLI E2E: init -> generate -> doctor", () => {
  let tmpDir: string;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rr-e2e-"));

    // Create a minimal repo structure the profiler can scan
    await fs.writeFile(
      path.join(tmpDir, "README.md"),
      "# Test Project\nA test project for E2E.\n",
    );
    await fs.mkdir(path.join(tmpDir, "src"), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, "src", "index.ts"),
      "export const main = () => {};\n",
    );

    // Git init so profiler and commit hash detection work
    const { execSync } = await import("node:child_process");
    execSync("git init && git add -A && git commit -m init", {
      cwd: tmpDir,
      stdio: "ignore",
    });

    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process.stderr, "write").mockReturnValue(true);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("init creates project, generate produces versioned output, doctor reports healthy", async () => {
    const slug = path.basename(tmpDir);

    // ===================== INIT =====================
    await runInit({ repoRoot: tmpDir });

    const reporeadDir = path.join(tmpDir, ".reporead");
    const projectJson = path.join(
      reporeadDir,
      "projects",
      slug,
      "project.json",
    );
    expect(
      await fs.access(reporeadDir).then(() => true).catch(() => false),
    ).toBe(true);
    expect(
      await fs.access(projectJson).then(() => true).catch(() => false),
    ).toBe(true);

    // Overwrite project config with a known "budget" preset so call count
    // is deterministic (forkWorkers=1 fast-paths the evidence planner).
    // This prevents the user's global ~/.reporead/config.json from changing
    // the preset or provider and breaking the mock sequence.
    const projectDir = path.join(reporeadDir, "projects", slug);
    await fs.writeFile(
      path.join(projectDir, "config.json"),
      JSON.stringify(
        {
          projectSlug: slug,
          repoRoot: tmpDir,
          preset: "budget",
          language: "zh",
          providers: [
            {
              provider: "anthropic",
              secretRef: "ANTHROPIC_API_KEY",
              enabled: true,
            },
          ],
          roles: {
            "main.author": { model: "claude-sonnet-4-6", fallback_models: [] },
            "fork.worker": {
              model: "claude-haiku-4-5-20251001",
              fallback_models: [],
            },
            "fresh.reviewer": {
              model: "claude-sonnet-4-6",
              fallback_models: [],
            },
          },
        },
        null,
        2,
      ),
    );

    // ===================== SETUP MOCKS FOR GENERATE =====================
    const { generateText } = await import("ai");
    const mockGen = vi.mocked(generateText);

    // Call sequence with budget preset (forkWorkers=1, fast-path planner):
    //   1. Catalog planner
    //   For each page (overview, core):
    //     - 1 fork.worker evidence call
    //     - 1 outline planner call
    //     - 1 drafter call
    //     - 1 reviewer call
    // Total: 1 + 2*4 = 9
    mockGen
      // 1. Catalog
      .mockResolvedValueOnce({ text: JSON.stringify(wikiJson) } as never)
      // 2-5. Page "overview": worker, outline, draft, review
      .mockResolvedValueOnce({ text: workerOutput("README.md") } as never)
      .mockResolvedValueOnce({ text: outlineOutput("README.md") } as never)
      .mockResolvedValueOnce({
        text: draftMd("overview", "Overview", "README.md"),
      } as never)
      .mockResolvedValueOnce({ text: passReview } as never)
      // 6-9. Page "core": worker, outline, draft, review
      .mockResolvedValueOnce({ text: workerOutput("src/index.ts") } as never)
      .mockResolvedValueOnce({ text: outlineOutput("src/index.ts") } as never)
      .mockResolvedValueOnce({
        text: draftMd("core", "Core", "src/index.ts"),
      } as never)
      .mockResolvedValueOnce({ text: passReview } as never);

    // ===================== GENERATE =====================
    // Reset exitCode in case prior test pollution
    process.exitCode = undefined;
    await runGenerate({ dir: tmpDir });

    // Verify success
    expect(process.exitCode).toBeUndefined();
    expect(mockGen).toHaveBeenCalledTimes(9);

    // ===================== VERIFY OUTPUT =====================
    const versionsDir = path.join(
      reporeadDir,
      "projects",
      slug,
      "versions",
    );
    const versionDirs = await fs.readdir(versionsDir).catch(() => []);
    expect(versionDirs.length).toBeGreaterThanOrEqual(1);

    const latestVersion = versionDirs[0];

    // wiki.json was published
    const versionWiki = path.join(versionsDir, latestVersion, "wiki.json");
    expect(
      await fs.access(versionWiki).then(() => true).catch(() => false),
    ).toBe(true);

    // Read wiki.json and verify content
    const wikiContent = JSON.parse(await fs.readFile(versionWiki, "utf-8"));
    expect(wikiContent.summary).toBe("Test project");
    expect(wikiContent.reading_order).toHaveLength(2);
    expect(wikiContent.reading_order[0].slug).toBe("overview");
    expect(wikiContent.reading_order[1].slug).toBe("core");

    // Both page markdown files were published
    const pageDir = path.join(versionsDir, latestVersion, "pages");
    for (const pageSlug of ["overview", "core"]) {
      const pageMd = path.join(pageDir, `${pageSlug}.md`);
      expect(
        await fs.access(pageMd).then(() => true).catch(() => false),
      ).toBe(true);

      const pageContent = await fs.readFile(pageMd, "utf-8");
      expect(pageContent).toContain(`# ${pageSlug === "overview" ? "Overview" : "Core"}`);
      expect(pageContent).toContain("[cite:file:");

      const pageMeta = path.join(pageDir, `${pageSlug}.meta.json`);
      expect(
        await fs.access(pageMeta).then(() => true).catch(() => false),
      ).toBe(true);
    }

    // ===================== DOCTOR =====================
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    await runDoctor({ dir: tmpDir });

    const doctorOutput = logSpy.mock.calls
      .map((c) => String(c[0]))
      .join("\n");

    // Doctor should report the project as registered and config as valid
    expect(doctorOutput).toContain("Project registered");
    expect(doctorOutput).toContain("Config valid");
    // No incomplete jobs (the completed job should not show as incomplete)
    expect(doctorOutput).toContain("No incomplete jobs");
  }, 30000);
});
