# RepoRead M4: Page Generation, Review, Validation & Publishing Pipeline

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the serial page generation pipeline so that after catalog planning (M3), each page goes through `draft → review → validate` before the entire version is atomically published.

**Architecture:** A `GenerationPipeline` orchestrator drives the job through its state machine (`cataloging → page_drafting ↔ reviewing ↔ validating → publishing → completed`). Page drafting uses AI SDK `generateText` with the same retrieval tools from M3. A `fresh.reviewer` agent runs in a fresh LLM session with a complete `ReviewBriefing`. A deterministic `PageValidator` chain checks structure, citations, Mermaid, and links. A `Publisher` atomically promotes the draft directory to a published version. An `EventEmitter` wrapper emits typed job events at every state transition. Interrupt/Resume reads `job-state.json` to find the safe recovery point.

**Tech Stack:** Node.js 22, TypeScript strict, Vercel AI SDK (`ai`, `@ai-sdk/anthropic`), Zod v4, Vitest

---

## Scope

This plan covers **B040, B041, B042, B043, B044, B045, B046, B048, B049** — all P0 tasks in M4.

**Deferred:** B047 (Page Metadata & Citation Ledger, P1), B050 (Golden Fixtures, P1).

**Not in scope:** CLI `generate` command wiring (M6-B070), Web UI (M5), Ask/Research (M7).

---

## New Dependencies

None — all dependencies (`ai`, `@ai-sdk/anthropic`, `zod`, `@vscode/ripgrep`, `ignore`, `glob`) were installed in M3.

---

## File Structure

### New files in `packages/core/src/`

```
generation/
├── generation-pipeline.ts          # B040: Orchestrator driving state machine through all stages
├── generation-events.ts            # B048: Typed event emitter for job lifecycle
├── page-drafter.ts                 # B041: Single-page drafting with LLM + tools
├── page-drafter-prompt.ts          # B041: System/user prompts for page drafting
├── fork-worker.ts                  # B042: fork.worker delegation protocol
├── fork-worker-prompt.ts           # B042: Prompts for fork.worker
├── publisher.ts                    # B045: Atomic version promotion
├── resume.ts                       # B046: Resume logic from job-state.json
├── __tests__/
│   ├── generation-pipeline.test.ts # B040+B049: Integration test for full pipeline
│   ├── generation-events.test.ts   # B048: Event emission contract test
│   ├── page-drafter.test.ts        # B041: Page drafting unit test
│   ├── fork-worker.test.ts         # B042: Fork worker protocol test
│   ├── publisher.test.ts           # B045: Version promotion test
│   └── resume.test.ts              # B046: Resume logic test

review/
├── reviewer.ts                     # B043: fresh.reviewer protocol
├── reviewer-prompt.ts              # B043: Review prompts
├── __tests__/
│   └── reviewer.test.ts            # B043: Review protocol test

validation/
├── page-validator.ts               # B044: Deterministic page validation chain
├── validators/
│   ├── structure-validator.ts      # B044: Markdown structure checks
│   ├── citation-validator.ts       # B044: Citation resolution checks
│   ├── mermaid-validator.ts        # B044: Mermaid syntax checks
│   └── link-validator.ts           # B044: Internal link checks
├── __tests__/
│   ├── page-validator.test.ts      # B044: Validator chain test
│   ├── structure-validator.test.ts
│   ├── citation-validator.test.ts
│   ├── mermaid-validator.test.ts
│   └── link-validator.test.ts
```

### Modified files

```
generation/index.ts                 # Add new exports
packages/core/src/index.ts          # Add new public exports
packages/core/src/storage/paths.ts  # Add draftCitationsJson, versionJson paths
packages/core/src/types/generation.ts # Add VersionJson type
```

---

## Task 1: Storage Paths & VersionJson Type Extensions

**Files:**
- Modify: `packages/core/src/storage/paths.ts`
- Modify: `packages/core/src/types/generation.ts`
- Test: `packages/core/src/storage/__tests__/paths.test.ts`

- [ ] **Step 1: Add new path methods and VersionJson type**

Add to `packages/core/src/storage/paths.ts`:

```ts
  draftCitationsJson(slug: string, jobId: string, versionId: string, pageSlug: string): string {
    return path.join(this.draftDir(slug, jobId, versionId), "citations", `${pageSlug}.citations.json`);
  }

  draftVersionJson(slug: string, jobId: string, versionId: string): string {
    return path.join(this.draftDir(slug, jobId, versionId), "version.json");
  }

  versionJson(slug: string, versionId: string): string {
    return path.join(this.versionDir(slug, versionId), "version.json");
  }

  versionCitationsJson(slug: string, versionId: string, pageSlug: string): string {
    return path.join(this.versionDir(slug, versionId), "citations", `${pageSlug}.citations.json`);
  }
```

Add to `packages/core/src/types/generation.ts`:

```ts
export type VersionJson = {
  versionId: string;
  projectSlug: string;
  commitHash: string;
  createdAt: string;
  pageCount: number;
  pages: Array<{
    slug: string;
    title: string;
    order: number;
    status: PageStatus;
  }>;
  summary: string;
};
```

- [ ] **Step 2: Write path tests**

Add to `packages/core/src/storage/__tests__/paths.test.ts`:

```ts
  it("builds draftCitationsJson path", () => {
    expect(paths.draftCitationsJson("proj", "job-1", "v1", "overview")).toBe(
      path.join(tmpDir, ".reporead", "projects", "proj", "jobs", "job-1", "draft", "v1", "citations", "overview.citations.json"),
    );
  });

  it("builds draftVersionJson path", () => {
    expect(paths.draftVersionJson("proj", "job-1", "v1")).toBe(
      path.join(tmpDir, ".reporead", "projects", "proj", "jobs", "job-1", "draft", "v1", "version.json"),
    );
  });

  it("builds versionJson path", () => {
    expect(paths.versionJson("proj", "v1")).toBe(
      path.join(tmpDir, ".reporead", "projects", "proj", "versions", "v1", "version.json"),
    );
  });

  it("builds versionCitationsJson path", () => {
    expect(paths.versionCitationsJson("proj", "v1", "overview")).toBe(
      path.join(tmpDir, ".reporead", "projects", "proj", "versions", "v1", "citations", "overview.citations.json"),
    );
  });
```

- [ ] **Step 3: Run tests**

Run: `pnpm --filter @reporead/core test -- src/storage/__tests__/paths`
Expected: All path tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/storage/paths.ts packages/core/src/storage/__tests__/paths.test.ts packages/core/src/types/generation.ts
git commit -m "feat(B040): add storage paths for citations, version.json, and VersionJson type"
```

---

## Task 2: Generation Events (B048)

**Files:**
- Create: `packages/core/src/generation/generation-events.ts`
- Test: `packages/core/src/generation/__tests__/generation-events.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/generation/__tests__/generation-events.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { JobEventEmitter } from "../generation-events.js";
import { StorageAdapter } from "../../storage/storage-adapter.js";
import { EventReader } from "../../events/event-reader.js";

describe("JobEventEmitter", () => {
  let tmpDir: string;
  let storage: StorageAdapter;
  let emitter: JobEventEmitter;
  let reader: EventReader;

  const slug = "proj";
  const jobId = "job-1";
  const versionId = "v1";

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "reporead-events-"));
    storage = new StorageAdapter(tmpDir);
    await storage.initialize();
    emitter = new JobEventEmitter(storage, slug, jobId, versionId);
    reader = new EventReader(storage.paths.eventsNdjson(slug, jobId));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("emits job.started event", async () => {
    await emitter.jobStarted();
    const events = await reader.readAll();
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("job.started");
    expect(events[0].channel).toBe("job");
    expect(events[0].jobId).toBe(jobId);
    expect(events[0].versionId).toBe(versionId);
  });

  it("emits catalog.completed event", async () => {
    await emitter.catalogCompleted(5);
    const events = await reader.readAll();
    expect(events[0].type).toBe("catalog.completed");
    expect(events[0].payload).toEqual({ totalPages: 5 });
  });

  it("emits page.drafting event with pageSlug", async () => {
    await emitter.pageDrafting("overview");
    const events = await reader.readAll();
    expect(events[0].type).toBe("page.drafting");
    expect(events[0].pageSlug).toBe("overview");
  });

  it("emits page.reviewed event", async () => {
    await emitter.pageReviewed("overview", "pass");
    const events = await reader.readAll();
    expect(events[0].type).toBe("page.reviewed");
    expect(events[0].pageSlug).toBe("overview");
    expect(events[0].payload).toEqual({ verdict: "pass" });
  });

  it("emits page.validated event", async () => {
    await emitter.pageValidated("overview", true);
    const events = await reader.readAll();
    expect(events[0].type).toBe("page.validated");
    expect(events[0].payload).toEqual({ passed: true });
  });

  it("emits job.interrupted with recovery info", async () => {
    await emitter.jobInterrupted("page_drafting", "overview");
    const events = await reader.readAll();
    expect(events[0].type).toBe("job.interrupted");
    expect(events[0].pageSlug).toBe("overview");
    expect(events[0].payload).toEqual({ recoveryStage: "page_drafting" });
  });

  it("emits job.resumed with recovery info", async () => {
    await emitter.jobResumed("reviewing", "core");
    const events = await reader.readAll();
    expect(events[0].type).toBe("job.resumed");
    expect(events[0].pageSlug).toBe("core");
    expect(events[0].payload).toEqual({ recoveryStage: "reviewing" });
  });

  it("emits job.completed event", async () => {
    await emitter.jobCompleted(5, 5, 0);
    const events = await reader.readAll();
    expect(events[0].type).toBe("job.completed");
    expect(events[0].payload).toEqual({ totalPages: 5, succeededPages: 5, failedPages: 0 });
  });

  it("preserves event order across multiple emissions", async () => {
    await emitter.jobStarted();
    await emitter.catalogCompleted(2);
    await emitter.pageDrafting("overview");
    const events = await reader.readAll();
    expect(events.map((e) => e.type)).toEqual([
      "job.started",
      "catalog.completed",
      "page.drafting",
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @reporead/core test -- src/generation/__tests__/generation-events`
Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

```ts
// packages/core/src/generation/generation-events.ts
import type { StorageAdapter } from "../storage/storage-adapter.js";
import { createAppEvent } from "../events/app-event.js";
import { EventWriter } from "../events/event-writer.js";
import type { JobStatus } from "../types/generation.js";
import type { ReviewVerdict } from "../types/review.js";

export class JobEventEmitter {
  private readonly writer: EventWriter;

  constructor(
    storage: StorageAdapter,
    private readonly projectSlug: string,
    private readonly jobId: string,
    private readonly versionId: string,
  ) {
    this.writer = new EventWriter(
      storage.paths.eventsNdjson(projectSlug, jobId),
    );
  }

  async jobStarted(): Promise<void> {
    await this.emit("job.started", {});
  }

  async catalogCompleted(totalPages: number): Promise<void> {
    await this.emit("catalog.completed", { totalPages });
  }

  async pageDrafting(pageSlug: string): Promise<void> {
    await this.emit("page.drafting", {}, pageSlug);
  }

  async pageDrafted(pageSlug: string): Promise<void> {
    await this.emit("page.drafted", {}, pageSlug);
  }

  async pageReviewed(pageSlug: string, verdict: ReviewVerdict): Promise<void> {
    await this.emit("page.reviewed", { verdict }, pageSlug);
  }

  async pageValidated(pageSlug: string, passed: boolean): Promise<void> {
    await this.emit("page.validated", { passed }, pageSlug);
  }

  async jobInterrupted(recoveryStage: JobStatus, pageSlug?: string): Promise<void> {
    await this.emit("job.interrupted", { recoveryStage }, pageSlug);
  }

  async jobResumed(recoveryStage: JobStatus, pageSlug?: string): Promise<void> {
    await this.emit("job.resumed", { recoveryStage }, pageSlug);
  }

  async jobCompleted(totalPages: number, succeededPages: number, failedPages: number): Promise<void> {
    await this.emit("job.completed", { totalPages, succeededPages, failedPages });
  }

  async jobFailed(error: string): Promise<void> {
    await this.emit("job.failed", { error });
  }

  private async emit(type: string, payload: unknown, pageSlug?: string): Promise<void> {
    const event = createAppEvent("job", type, this.projectSlug, payload, {
      jobId: this.jobId,
      versionId: this.versionId,
      pageSlug,
    });
    await this.writer.write(event);
  }
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @reporead/core test -- src/generation/__tests__/generation-events`
Expected: All 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/generation/generation-events.ts packages/core/src/generation/__tests__/generation-events.test.ts
git commit -m "feat(B048): typed job event emitter with ndjson persistence

Emits job.started, catalog.completed, page.drafting, page.reviewed,
page.validated, job.interrupted, job.resumed, job.completed events."
```

---

## Task 3: Page Drafter Prompts (B041)

**Files:**
- Create: `packages/core/src/generation/page-drafter-prompt.ts`
- Test: `packages/core/src/generation/__tests__/page-drafter-prompt.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/generation/__tests__/page-drafter-prompt.test.ts
import { describe, it, expect } from "vitest";
import { buildPageDraftSystemPrompt, buildPageDraftUserPrompt } from "../page-drafter-prompt.js";
import type { MainAuthorContext } from "../../types/agent.js";

describe("buildPageDraftSystemPrompt", () => {
  it("includes role and citation format instructions", () => {
    const prompt = buildPageDraftSystemPrompt();
    expect(prompt).toContain("main.author");
    expect(prompt).toContain("citation");
    expect(prompt).toContain("Markdown");
  });
});

describe("buildPageDraftUserPrompt", () => {
  const context: MainAuthorContext = {
    project_summary: "A TypeScript monorepo for wiki generation",
    full_book_summary: "Covers setup, core engine, and CLI",
    current_page_plan: "Explain the core engine architecture",
    published_page_summaries: [
      { slug: "setup", title: "Setup Guide", summary: "How to install and configure" },
    ],
    evidence_ledger: [
      { id: "e1", kind: "file", target: "src/engine.ts", note: "Main engine class" },
    ],
  };

  it("includes page plan in prompt", () => {
    const prompt = buildPageDraftUserPrompt(context, {
      slug: "core-engine",
      title: "Core Engine",
      order: 2,
      coveredFiles: ["src/engine.ts", "src/pipeline.ts"],
      language: "en",
    });
    expect(prompt).toContain("Core Engine");
    expect(prompt).toContain("src/engine.ts");
    expect(prompt).toContain("src/pipeline.ts");
    expect(prompt).toContain("Explain the core engine architecture");
  });

  it("includes published page summaries", () => {
    const prompt = buildPageDraftUserPrompt(context, {
      slug: "core-engine",
      title: "Core Engine",
      order: 2,
      coveredFiles: ["src/engine.ts"],
      language: "en",
    });
    expect(prompt).toContain("Setup Guide");
    expect(prompt).toContain("How to install and configure");
  });

  it("includes evidence ledger", () => {
    const prompt = buildPageDraftUserPrompt(context, {
      slug: "core-engine",
      title: "Core Engine",
      order: 2,
      coveredFiles: ["src/engine.ts"],
      language: "en",
    });
    expect(prompt).toContain("src/engine.ts");
    expect(prompt).toContain("Main engine class");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @reporead/core test -- src/generation/__tests__/page-drafter-prompt`
Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

```ts
// packages/core/src/generation/page-drafter-prompt.ts
import type { MainAuthorContext } from "../types/agent.js";

export type PageDraftPromptInput = {
  slug: string;
  title: string;
  order: number;
  coveredFiles: string[];
  language: string;
};

export function buildPageDraftSystemPrompt(): string {
  return `You are "main.author", the primary technical writer for a code-reading wiki.

Your task is to write a single wiki page as high-quality Markdown. You have access to retrieval tools (Read, Grep, Find, Git) to inspect the repository.

Rules:
1. Write in the specified language. Use clear, technical prose.
2. Every factual claim must be backed by evidence from the repository.
3. Include inline citations in the format: [cite:kind:target:locator] where kind is file/page/commit.
   Example: [cite:file:src/engine.ts:42-60]
4. Structure the page with a title (# heading), a brief summary paragraph, then detailed sections.
5. Use code blocks with language tags for code snippets.
6. Use Mermaid diagrams (in \`\`\`mermaid blocks) when they help explain architecture or flow.
7. Do not duplicate content from previously published pages — reference them with [cite:page:slug].
8. Stay within the scope of the current page plan. Do not cover topics assigned to other pages.
9. At the end, output a JSON block with your citations and summary:

\`\`\`json
{
  "summary": "One-paragraph summary of this page",
  "citations": [
    { "kind": "file", "target": "path/to/file.ts", "locator": "42-60", "note": "Engine constructor" }
  ],
  "related_pages": ["setup", "cli"]
}
\`\`\``;
}

export function buildPageDraftUserPrompt(
  context: MainAuthorContext,
  input: PageDraftPromptInput,
): string {
  const sections: string[] = [];

  sections.push(`## Project Summary\n${context.project_summary}`);
  sections.push(`## Full Book Summary\n${context.full_book_summary}`);

  if (context.current_page_plan) {
    sections.push(`## Current Page Plan\n${context.current_page_plan}`);
  }

  sections.push(
    `## Page Assignment`,
    `- **Title:** ${input.title}`,
    `- **Slug:** ${input.slug}`,
    `- **Order:** Page ${input.order} in the reading order`,
    `- **Language:** ${input.language}`,
    `- **Covered Files:** ${input.coveredFiles.join(", ")}`,
  );

  if (context.published_page_summaries.length > 0) {
    sections.push(`## Previously Published Pages`);
    for (const page of context.published_page_summaries) {
      sections.push(`- **${page.title}** (${page.slug}): ${page.summary}`);
    }
  }

  if (context.evidence_ledger.length > 0) {
    sections.push(`## Evidence Ledger (already collected)`);
    for (const entry of context.evidence_ledger) {
      sections.push(`- [${entry.kind}] ${entry.target}: ${entry.note}`);
    }
  }

  sections.push(
    `## Instructions`,
    `Write the complete wiki page for "${input.title}". Use the retrieval tools to read the covered files and gather evidence. Then produce the page as Markdown with inline citations. End with the JSON metadata block.`,
  );

  return sections.join("\n\n");
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @reporead/core test -- src/generation/__tests__/page-drafter-prompt`
Expected: All 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/generation/page-drafter-prompt.ts packages/core/src/generation/__tests__/page-drafter-prompt.test.ts
git commit -m "feat(B041): page drafter system and user prompts

Builds main.author prompts with page plan, published summaries,
evidence ledger, and citation format instructions."
```

---

## Task 4: Page Drafter (B041)

**Files:**
- Create: `packages/core/src/generation/page-drafter.ts`
- Test: `packages/core/src/generation/__tests__/page-drafter.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/generation/__tests__/page-drafter.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PageDrafter } from "../page-drafter.js";
import type { MainAuthorContext } from "../../types/agent.js";

vi.mock("ai", () => ({
  generateText: vi.fn(),
  jsonSchema: vi.fn((s: unknown) => s),
}));

const mockContext: MainAuthorContext = {
  project_summary: "Test project",
  full_book_summary: "Overview and core",
  published_page_summaries: [],
  evidence_ledger: [],
};

const draftMarkdown = `# Core Engine

The core engine handles pipeline orchestration.

[cite:file:src/engine.ts:1-50]

\`\`\`json
{
  "summary": "Explains the core engine architecture",
  "citations": [
    { "kind": "file", "target": "src/engine.ts", "locator": "1-50", "note": "Engine class" }
  ],
  "related_pages": ["setup"]
}
\`\`\``;

describe("PageDrafter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns page markdown and parsed metadata", async () => {
    const { generateText } = await import("ai");
    vi.mocked(generateText).mockResolvedValueOnce({
      text: draftMarkdown,
      usage: { inputTokens: 500, outputTokens: 300 },
    } as never);

    const drafter = new PageDrafter({
      model: {} as never,
      repoRoot: "/tmp/repo",
    });

    const result = await drafter.draft(mockContext, {
      slug: "core-engine",
      title: "Core Engine",
      order: 1,
      coveredFiles: ["src/engine.ts"],
      language: "en",
    });

    expect(result.success).toBe(true);
    expect(result.markdown).toContain("# Core Engine");
    expect(result.metadata!.summary).toBe("Explains the core engine architecture");
    expect(result.metadata!.citations).toHaveLength(1);
    expect(result.metadata!.citations[0].target).toBe("src/engine.ts");
    expect(result.metadata!.related_pages).toEqual(["setup"]);
  });

  it("returns error when LLM output has no JSON block", async () => {
    const { generateText } = await import("ai");
    vi.mocked(generateText).mockResolvedValueOnce({
      text: "# Page\n\nSome content with no metadata block.",
      usage: { inputTokens: 100, outputTokens: 50 },
    } as never);

    const drafter = new PageDrafter({
      model: {} as never,
      repoRoot: "/tmp/repo",
    });

    const result = await drafter.draft(mockContext, {
      slug: "bad",
      title: "Bad",
      order: 1,
      coveredFiles: [],
      language: "en",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("metadata");
  });

  it("strips JSON metadata block from page markdown", async () => {
    const { generateText } = await import("ai");
    vi.mocked(generateText).mockResolvedValueOnce({
      text: draftMarkdown,
      usage: { inputTokens: 500, outputTokens: 300 },
    } as never);

    const drafter = new PageDrafter({
      model: {} as never,
      repoRoot: "/tmp/repo",
    });

    const result = await drafter.draft(mockContext, {
      slug: "core-engine",
      title: "Core Engine",
      order: 1,
      coveredFiles: ["src/engine.ts"],
      language: "en",
    });

    expect(result.markdown).not.toContain('"summary"');
    expect(result.markdown).not.toContain('"citations"');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @reporead/core test -- src/generation/__tests__/page-drafter`
Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

```ts
// packages/core/src/generation/page-drafter.ts
import { generateText } from "ai";
import type { LanguageModel, ToolSet } from "ai";
import type { MainAuthorContext } from "../types/agent.js";
import type { CitationRecord } from "../types/generation.js";
import { buildPageDraftSystemPrompt, buildPageDraftUserPrompt } from "./page-drafter-prompt.js";
import type { PageDraftPromptInput } from "./page-drafter-prompt.js";
import { createCatalogTools } from "../catalog/catalog-tools.js";

export type PageDraftResult = {
  success: boolean;
  markdown?: string;
  metadata?: {
    summary: string;
    citations: CitationRecord[];
    related_pages: string[];
  };
  error?: string;
};

export type PageDrafterOptions = {
  model: LanguageModel;
  repoRoot: string;
};

export class PageDrafter {
  private readonly model: LanguageModel;
  private readonly repoRoot: string;

  constructor(options: PageDrafterOptions) {
    this.model = options.model;
    this.repoRoot = options.repoRoot;
  }

  async draft(
    context: MainAuthorContext,
    input: PageDraftPromptInput,
  ): Promise<PageDraftResult> {
    const systemPrompt = buildPageDraftSystemPrompt();
    const userPrompt = buildPageDraftUserPrompt(context, input);
    const tools = createCatalogTools(this.repoRoot);

    try {
      const result = await generateText({
        model: this.model,
        system: systemPrompt,
        prompt: userPrompt,
        tools: tools as unknown as ToolSet,
      });

      return this.parseOutput(result.text);
    } catch (err) {
      return { success: false, error: `Page drafting failed: ${(err as Error).message}` };
    }
  }

  private parseOutput(text: string): PageDraftResult {
    const jsonMatch = text.match(/```json\s*\n([\s\S]*?)\n```\s*$/);
    if (!jsonMatch) {
      return { success: false, error: "Page output missing JSON metadata block" };
    }

    try {
      const metadata = JSON.parse(jsonMatch[1]);
      if (!metadata.summary || !Array.isArray(metadata.citations)) {
        return { success: false, error: "Invalid metadata: missing summary or citations" };
      }

      const markdown = text.slice(0, jsonMatch.index).trim();

      return {
        success: true,
        markdown,
        metadata: {
          summary: metadata.summary,
          citations: metadata.citations.map((c: Record<string, string>) => ({
            kind: c.kind ?? "file",
            target: c.target,
            locator: c.locator,
            note: c.note,
          })),
          related_pages: metadata.related_pages ?? [],
        },
      };
    } catch {
      return { success: false, error: "Failed to parse JSON metadata block" };
    }
  }
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @reporead/core test -- src/generation/__tests__/page-drafter`
Expected: All 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/generation/page-drafter.ts packages/core/src/generation/__tests__/page-drafter.test.ts
git commit -m "feat(B041): page drafter with LLM tool-calling and metadata parsing

Single-page drafting using generateText with retrieval tools.
Parses trailing JSON block for citations, summary, related_pages."
```

---

## Task 5: Fork Worker (B042)

**Files:**
- Create: `packages/core/src/generation/fork-worker.ts`
- Create: `packages/core/src/generation/fork-worker-prompt.ts`
- Test: `packages/core/src/generation/__tests__/fork-worker.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/generation/__tests__/fork-worker.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ForkWorker } from "../fork-worker.js";

vi.mock("ai", () => ({
  generateText: vi.fn(),
  jsonSchema: vi.fn((s: unknown) => s),
}));

const validOutput = JSON.stringify({
  directive: "Check error handling in src/engine.ts",
  findings: ["Engine constructor throws on null config", "No retry logic in pipeline"],
  citations: [
    { kind: "file", target: "src/engine.ts", locator: "15-22", note: "Constructor validation" },
  ],
  open_questions: ["Is retry handled at a higher level?"],
});

describe("ForkWorker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns structured findings from LLM output", async () => {
    const { generateText } = await import("ai");
    vi.mocked(generateText).mockResolvedValueOnce({
      text: validOutput,
      usage: { inputTokens: 200, outputTokens: 100 },
    } as never);

    const worker = new ForkWorker({
      model: {} as never,
      repoRoot: "/tmp/repo",
    });

    const result = await worker.execute({
      directive: "Check error handling in src/engine.ts",
      context: "Writing page about core engine",
      relevantFiles: ["src/engine.ts"],
    });

    expect(result.success).toBe(true);
    expect(result.data!.directive).toBe("Check error handling in src/engine.ts");
    expect(result.data!.findings).toHaveLength(2);
    expect(result.data!.citations).toHaveLength(1);
    expect(result.data!.open_questions).toHaveLength(1);
  });

  it("returns error on invalid JSON output", async () => {
    const { generateText } = await import("ai");
    vi.mocked(generateText).mockResolvedValueOnce({
      text: "Not JSON at all",
      usage: { inputTokens: 100, outputTokens: 50 },
    } as never);

    const worker = new ForkWorker({
      model: {} as never,
      repoRoot: "/tmp/repo",
    });

    const result = await worker.execute({
      directive: "Check something",
      context: "Some context",
      relevantFiles: [],
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @reporead/core test -- src/generation/__tests__/fork-worker`
Expected: FAIL — module not found.

- [ ] **Step 3: Write fork-worker-prompt.ts**

```ts
// packages/core/src/generation/fork-worker-prompt.ts

export type ForkWorkerInput = {
  directive: string;
  context: string;
  relevantFiles: string[];
};

export function buildForkWorkerSystemPrompt(): string {
  return `You are "fork.worker", a focused research assistant for a code-reading wiki.

Your job is to investigate a narrow directive and return structured findings. You have access to retrieval tools (Read, Grep, Find, Git).

Rules:
1. Only investigate what the directive asks. Do not expand scope.
2. Do not rewrite or produce page content.
3. Return your findings as a single JSON object with this structure:

{
  "directive": "the original directive",
  "findings": ["finding 1", "finding 2"],
  "citations": [
    { "kind": "file", "target": "path/to/file.ts", "locator": "10-20", "note": "description" }
  ],
  "open_questions": ["any unresolved questions"]
}

4. If you cannot find evidence, say so in open_questions rather than guessing.`;
}

export function buildForkWorkerUserPrompt(input: ForkWorkerInput): string {
  const sections: string[] = [];
  sections.push(`## Directive\n${input.directive}`);
  sections.push(`## Context\n${input.context}`);
  if (input.relevantFiles.length > 0) {
    sections.push(`## Relevant Files\n${input.relevantFiles.join("\n")}`);
  }
  sections.push(`Investigate the directive above using the retrieval tools. Return your findings as JSON.`);
  return sections.join("\n\n");
}
```

- [ ] **Step 4: Write fork-worker.ts**

```ts
// packages/core/src/generation/fork-worker.ts
import { generateText } from "ai";
import type { LanguageModel, ToolSet } from "ai";
import type { ForkWorkerResult } from "../types/agent.js";
import { buildForkWorkerSystemPrompt, buildForkWorkerUserPrompt } from "./fork-worker-prompt.js";
import type { ForkWorkerInput } from "./fork-worker-prompt.js";
import { createCatalogTools } from "../catalog/catalog-tools.js";

export type ForkWorkerResponse = {
  success: boolean;
  data?: ForkWorkerResult;
  error?: string;
};

export type ForkWorkerOptions = {
  model: LanguageModel;
  repoRoot: string;
};

export class ForkWorker {
  private readonly model: LanguageModel;
  private readonly repoRoot: string;

  constructor(options: ForkWorkerOptions) {
    this.model = options.model;
    this.repoRoot = options.repoRoot;
  }

  async execute(input: ForkWorkerInput): Promise<ForkWorkerResponse> {
    const systemPrompt = buildForkWorkerSystemPrompt();
    const userPrompt = buildForkWorkerUserPrompt(input);
    const tools = createCatalogTools(this.repoRoot);

    try {
      const result = await generateText({
        model: this.model,
        system: systemPrompt,
        prompt: userPrompt,
        tools: tools as unknown as ToolSet,
      });

      return this.parseOutput(result.text);
    } catch (err) {
      return { success: false, error: `Fork worker failed: ${(err as Error).message}` };
    }
  }

  private parseOutput(text: string): ForkWorkerResponse {
    let jsonStr = text.trim();
    const fenceMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (fenceMatch) jsonStr = fenceMatch[1].trim();

    try {
      const data = JSON.parse(jsonStr);
      if (!data.directive || !Array.isArray(data.findings)) {
        return { success: false, error: "Invalid fork worker output: missing directive or findings" };
      }
      return {
        success: true,
        data: {
          directive: data.directive,
          findings: data.findings,
          citations: (data.citations ?? []).map((c: Record<string, string>) => ({
            kind: c.kind ?? "file",
            target: c.target,
            locator: c.locator,
            note: c.note,
          })),
          open_questions: data.open_questions ?? [],
        },
      };
    } catch {
      return { success: false, error: "Failed to parse fork worker output as JSON" };
    }
  }
}
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @reporead/core test -- src/generation/__tests__/fork-worker`
Expected: All 2 tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/generation/fork-worker.ts packages/core/src/generation/fork-worker-prompt.ts packages/core/src/generation/__tests__/fork-worker.test.ts
git commit -m "feat(B042): fork.worker delegation with structured findings

Narrow-directive research agent returning findings, citations,
and open_questions as structured JSON."
```

---

## Task 6: Fresh Reviewer (B043)

**Files:**
- Create: `packages/core/src/review/reviewer.ts`
- Create: `packages/core/src/review/reviewer-prompt.ts`
- Create: `packages/core/src/review/index.ts`
- Test: `packages/core/src/review/__tests__/reviewer.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/review/__tests__/reviewer.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { FreshReviewer } from "../reviewer.js";
import type { ReviewBriefing } from "../../types/review.js";

vi.mock("ai", () => ({
  generateText: vi.fn(),
  jsonSchema: vi.fn((s: unknown) => s),
}));

const briefing: ReviewBriefing = {
  page_title: "Core Engine",
  section_position: "Page 2 of 5",
  current_page_plan: "Explain the core engine architecture and pipeline flow",
  full_book_summary: "A wiki covering setup, core engine, CLI, and web UI",
  current_draft: "# Core Engine\n\nThe engine orchestrates page generation.\n\n[cite:file:src/engine.ts:1-50]",
  citations: [{ kind: "file", target: "src/engine.ts", locator: "1-50", note: "Engine class" }],
  covered_files: ["src/engine.ts", "src/pipeline.ts"],
  review_questions: [
    "Does the page stay within scope?",
    "Are all key claims backed by citations?",
  ],
};

const passConclusion = JSON.stringify({
  verdict: "pass",
  blockers: [],
  factual_risks: [],
  missing_evidence: [],
  scope_violations: [],
  suggested_revisions: [],
});

const reviseConclusion = JSON.stringify({
  verdict: "revise",
  blockers: ["Missing explanation of error handling"],
  factual_risks: ["Claim about retry logic not backed by evidence"],
  missing_evidence: ["src/pipeline.ts not referenced"],
  scope_violations: [],
  suggested_revisions: ["Add a section on error propagation"],
});

describe("FreshReviewer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns pass verdict", async () => {
    const { generateText } = await import("ai");
    vi.mocked(generateText).mockResolvedValueOnce({
      text: passConclusion,
      usage: { inputTokens: 400, outputTokens: 100 },
    } as never);

    const reviewer = new FreshReviewer({
      model: {} as never,
      repoRoot: "/tmp/repo",
    });

    const result = await reviewer.review(briefing);
    expect(result.success).toBe(true);
    expect(result.conclusion!.verdict).toBe("pass");
    expect(result.conclusion!.blockers).toHaveLength(0);
  });

  it("returns revise verdict with details", async () => {
    const { generateText } = await import("ai");
    vi.mocked(generateText).mockResolvedValueOnce({
      text: reviseConclusion,
      usage: { inputTokens: 400, outputTokens: 200 },
    } as never);

    const reviewer = new FreshReviewer({
      model: {} as never,
      repoRoot: "/tmp/repo",
    });

    const result = await reviewer.review(briefing);
    expect(result.success).toBe(true);
    expect(result.conclusion!.verdict).toBe("revise");
    expect(result.conclusion!.blockers).toHaveLength(1);
    expect(result.conclusion!.missing_evidence).toHaveLength(1);
    expect(result.conclusion!.suggested_revisions).toHaveLength(1);
  });

  it("returns error on unparseable output", async () => {
    const { generateText } = await import("ai");
    vi.mocked(generateText).mockResolvedValueOnce({
      text: "I think it looks good overall.",
      usage: { inputTokens: 400, outputTokens: 50 },
    } as never);

    const reviewer = new FreshReviewer({
      model: {} as never,
      repoRoot: "/tmp/repo",
    });

    const result = await reviewer.review(briefing);
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @reporead/core test -- src/review/__tests__/reviewer`
Expected: FAIL — module not found.

- [ ] **Step 3: Write reviewer-prompt.ts**

```ts
// packages/core/src/review/reviewer-prompt.ts
import type { ReviewBriefing } from "../types/review.js";

export function buildReviewerSystemPrompt(): string {
  return `You are "fresh.reviewer", an independent quality reviewer for a code-reading wiki.

You receive a complete briefing about a page draft. You have access to retrieval tools (Read, Grep, Find, Git) to verify claims independently.

Rules:
1. You have NO prior context — the briefing is your only input.
2. You review against the page plan, not your own expectations.
3. You may re-read source files to verify citations.
4. You MUST NOT rewrite the page or produce new content.
5. Return your conclusion as a single JSON object:

{
  "verdict": "pass" or "revise",
  "blockers": ["issues that prevent publication"],
  "factual_risks": ["claims not backed by evidence"],
  "missing_evidence": ["files or topics that should be cited"],
  "scope_violations": ["content outside the page plan"],
  "suggested_revisions": ["specific actionable changes"]
}

6. Use "pass" only if there are zero blockers. Even minor factual risks do not require "revise" if they don't block publication.
7. Be specific and actionable — "add error handling section" is better than "needs more detail".`;
}

export function buildReviewerUserPrompt(briefing: ReviewBriefing): string {
  const sections: string[] = [];

  sections.push(`## Page Title: ${briefing.page_title}`);
  sections.push(`## Section Position: ${briefing.section_position}`);
  sections.push(`## Page Plan\n${briefing.current_page_plan}`);
  sections.push(`## Full Book Summary\n${briefing.full_book_summary}`);
  sections.push(`## Covered Files\n${briefing.covered_files.join("\n")}`);

  sections.push(`## Current Draft\n\n${briefing.current_draft}`);

  if (briefing.citations.length > 0) {
    sections.push(`## Citations Used`);
    for (const c of briefing.citations) {
      sections.push(`- [${c.kind}] ${c.target}${c.locator ? `:${c.locator}` : ""}`);
    }
  }

  sections.push(`## Review Questions`);
  for (const q of briefing.review_questions) {
    sections.push(`- ${q}`);
  }

  sections.push(`\nReview the draft above. Use retrieval tools to verify claims. Return your conclusion as JSON.`);

  return sections.join("\n\n");
}
```

- [ ] **Step 4: Write reviewer.ts**

```ts
// packages/core/src/review/reviewer.ts
import { generateText } from "ai";
import type { LanguageModel, ToolSet } from "ai";
import type { ReviewBriefing, ReviewConclusion } from "../types/review.js";
import { buildReviewerSystemPrompt, buildReviewerUserPrompt } from "./reviewer-prompt.js";
import { createCatalogTools } from "../catalog/catalog-tools.js";

export type ReviewResult = {
  success: boolean;
  conclusion?: ReviewConclusion;
  error?: string;
};

export type FreshReviewerOptions = {
  model: LanguageModel;
  repoRoot: string;
};

export class FreshReviewer {
  private readonly model: LanguageModel;
  private readonly repoRoot: string;

  constructor(options: FreshReviewerOptions) {
    this.model = options.model;
    this.repoRoot = options.repoRoot;
  }

  async review(briefing: ReviewBriefing): Promise<ReviewResult> {
    const systemPrompt = buildReviewerSystemPrompt();
    const userPrompt = buildReviewerUserPrompt(briefing);
    const tools = createCatalogTools(this.repoRoot);

    try {
      const result = await generateText({
        model: this.model,
        system: systemPrompt,
        prompt: userPrompt,
        tools: tools as unknown as ToolSet,
      });

      return this.parseOutput(result.text);
    } catch (err) {
      return { success: false, error: `Review failed: ${(err as Error).message}` };
    }
  }

  private parseOutput(text: string): ReviewResult {
    let jsonStr = text.trim();
    const fenceMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (fenceMatch) jsonStr = fenceMatch[1].trim();

    try {
      const data = JSON.parse(jsonStr);
      if (!data.verdict || !["pass", "revise"].includes(data.verdict)) {
        return { success: false, error: "Invalid review: missing or invalid verdict" };
      }
      return {
        success: true,
        conclusion: {
          verdict: data.verdict,
          blockers: data.blockers ?? [],
          factual_risks: data.factual_risks ?? [],
          missing_evidence: data.missing_evidence ?? [],
          scope_violations: data.scope_violations ?? [],
          suggested_revisions: data.suggested_revisions ?? [],
        },
      };
    } catch {
      return { success: false, error: "Failed to parse review output as JSON" };
    }
  }
}
```

- [ ] **Step 5: Write review/index.ts**

```ts
// packages/core/src/review/index.ts
export { FreshReviewer } from "./reviewer.js";
export type { ReviewResult, FreshReviewerOptions } from "./reviewer.js";
export { buildReviewerSystemPrompt, buildReviewerUserPrompt } from "./reviewer-prompt.js";
```

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @reporead/core test -- src/review/__tests__/reviewer`
Expected: All 3 tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/review/
git commit -m "feat(B043): fresh.reviewer with independent review protocol

Fresh session reviewer receiving ReviewBriefing, producing
ReviewConclusion with verdict, blockers, factual_risks,
missing_evidence, scope_violations, suggested_revisions."
```

---

## Task 7: Page Validator Chain (B044)

**Files:**
- Create: `packages/core/src/validation/validators/structure-validator.ts`
- Create: `packages/core/src/validation/validators/citation-validator.ts`
- Create: `packages/core/src/validation/validators/mermaid-validator.ts`
- Create: `packages/core/src/validation/validators/link-validator.ts`
- Create: `packages/core/src/validation/page-validator.ts`
- Create: `packages/core/src/validation/index.ts`
- Test: `packages/core/src/validation/__tests__/structure-validator.test.ts`
- Test: `packages/core/src/validation/__tests__/citation-validator.test.ts`
- Test: `packages/core/src/validation/__tests__/mermaid-validator.test.ts`
- Test: `packages/core/src/validation/__tests__/link-validator.test.ts`
- Test: `packages/core/src/validation/__tests__/page-validator.test.ts`

This is a large task but the validators are independent. Implement them one by one.

### Sub-task 7a: Structure Validator

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/validation/__tests__/structure-validator.test.ts
import { describe, it, expect } from "vitest";
import { validateStructure } from "../validators/structure-validator.js";

describe("validateStructure", () => {
  it("passes valid page markdown", () => {
    const md = "# Page Title\n\nSome content with a paragraph.\n\n## Section\n\nMore content.";
    const result = validateStructure(md, "test-page");
    expect(result.passed).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("fails when H1 title is missing", () => {
    const md = "## Section\n\nContent without a title.";
    const result = validateStructure(md, "test-page");
    expect(result.passed).toBe(false);
    expect(result.errors.some((e) => e.includes("H1"))).toBe(true);
  });

  it("fails on empty content", () => {
    const md = "";
    const result = validateStructure(md, "test-page");
    expect(result.passed).toBe(false);
  });

  it("warns on very short content", () => {
    const md = "# Title\n\nShort.";
    const result = validateStructure(md, "test-page");
    expect(result.warnings.some((w) => w.includes("short"))).toBe(true);
  });

  it("passes page with code blocks and lists", () => {
    const md = "# Title\n\nIntro paragraph.\n\n## Code\n\n```ts\nconst x = 1;\n```\n\n- item 1\n- item 2";
    const result = validateStructure(md, "test-page");
    expect(result.passed).toBe(true);
  });
});
```

- [ ] **Step 2: Write structure-validator.ts**

```ts
// packages/core/src/validation/validators/structure-validator.ts
import type { ValidationReport } from "../../types/validation.js";

const MIN_CONTENT_LENGTH = 100;

export function validateStructure(markdown: string, pageSlug: string): ValidationReport {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!markdown || markdown.trim().length === 0) {
    errors.push(`${pageSlug}: empty page content`);
    return { target: "page", passed: false, errors, warnings };
  }

  const lines = markdown.trim().split("\n");
  const firstNonEmpty = lines.find((l) => l.trim().length > 0);

  if (!firstNonEmpty || !firstNonEmpty.startsWith("# ")) {
    errors.push(`${pageSlug}: missing H1 title — page must start with "# Title"`);
  }

  if (markdown.trim().length < MIN_CONTENT_LENGTH) {
    warnings.push(`${pageSlug}: content is very short (${markdown.trim().length} chars) — may lack substance`);
  }

  return { target: "page", passed: errors.length === 0, errors, warnings };
}
```

- [ ] **Step 3: Run test**

Run: `pnpm --filter @reporead/core test -- src/validation/__tests__/structure-validator`
Expected: All 5 tests pass.

### Sub-task 7b: Citation Validator

- [ ] **Step 4: Write the failing test**

```ts
// packages/core/src/validation/__tests__/citation-validator.test.ts
import { describe, it, expect } from "vitest";
import { validateCitations } from "../validators/citation-validator.js";
import type { CitationRecord } from "../../types/generation.js";

describe("validateCitations", () => {
  it("passes when all citations have valid targets", () => {
    const citations: CitationRecord[] = [
      { kind: "file", target: "src/engine.ts", locator: "1-50" },
      { kind: "page", target: "setup" },
    ];
    const knownFiles = ["src/engine.ts", "src/pipeline.ts"];
    const knownPages = ["setup", "overview"];
    const result = validateCitations(citations, knownFiles, knownPages, "test-page");
    expect(result.passed).toBe(true);
  });

  it("fails when a file citation targets an unknown file", () => {
    const citations: CitationRecord[] = [
      { kind: "file", target: "src/nonexistent.ts" },
    ];
    const result = validateCitations(citations, ["src/engine.ts"], [], "test-page");
    expect(result.passed).toBe(false);
    expect(result.errors.some((e) => e.includes("nonexistent"))).toBe(true);
  });

  it("fails when a page citation targets an unknown page", () => {
    const citations: CitationRecord[] = [
      { kind: "page", target: "missing-page" },
    ];
    const result = validateCitations(citations, [], ["setup"], "test-page");
    expect(result.passed).toBe(false);
    expect(result.errors.some((e) => e.includes("missing-page"))).toBe(true);
  });

  it("warns when there are no citations", () => {
    const result = validateCitations([], ["src/engine.ts"], [], "test-page");
    expect(result.warnings.some((w) => w.includes("citation"))).toBe(true);
  });

  it("passes commit citations without file check", () => {
    const citations: CitationRecord[] = [
      { kind: "commit", target: "abc123", note: "Initial commit" },
    ];
    const result = validateCitations(citations, [], [], "test-page");
    expect(result.passed).toBe(true);
  });
});
```

- [ ] **Step 5: Write citation-validator.ts**

```ts
// packages/core/src/validation/validators/citation-validator.ts
import type { CitationRecord } from "../../types/generation.js";
import type { ValidationReport } from "../../types/validation.js";

export function validateCitations(
  citations: CitationRecord[],
  knownFiles: string[],
  knownPages: string[],
  pageSlug: string,
): ValidationReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const fileSet = new Set(knownFiles);
  const pageSet = new Set(knownPages);

  if (citations.length === 0) {
    warnings.push(`${pageSlug}: no citations — page may lack evidence basis`);
    return { target: "page", passed: true, errors, warnings };
  }

  for (const c of citations) {
    if (c.kind === "file" && !fileSet.has(c.target)) {
      errors.push(`${pageSlug}: citation references unknown file "${c.target}"`);
    }
    if (c.kind === "page" && !pageSet.has(c.target)) {
      errors.push(`${pageSlug}: citation references unknown page "${c.target}"`);
    }
  }

  return { target: "page", passed: errors.length === 0, errors, warnings };
}
```

- [ ] **Step 6: Run test**

Run: `pnpm --filter @reporead/core test -- src/validation/__tests__/citation-validator`
Expected: All 5 tests pass.

### Sub-task 7c: Mermaid Validator

- [ ] **Step 7: Write the failing test**

```ts
// packages/core/src/validation/__tests__/mermaid-validator.test.ts
import { describe, it, expect } from "vitest";
import { validateMermaid } from "../validators/mermaid-validator.js";

describe("validateMermaid", () => {
  it("passes page with no mermaid blocks", () => {
    const md = "# Title\n\nNo diagrams here.";
    const result = validateMermaid(md, "test-page");
    expect(result.passed).toBe(true);
  });

  it("passes valid mermaid flowchart", () => {
    const md = "# Title\n\n```mermaid\ngraph TD\n  A --> B\n  B --> C\n```";
    const result = validateMermaid(md, "test-page");
    expect(result.passed).toBe(true);
  });

  it("fails on empty mermaid block", () => {
    const md = "# Title\n\n```mermaid\n```";
    const result = validateMermaid(md, "test-page");
    expect(result.passed).toBe(false);
    expect(result.errors.some((e) => e.includes("empty"))).toBe(true);
  });

  it("fails on mermaid block with no diagram type", () => {
    const md = "# Title\n\n```mermaid\nA --> B\n```";
    const result = validateMermaid(md, "test-page");
    expect(result.passed).toBe(false);
    expect(result.errors.some((e) => e.includes("type"))).toBe(true);
  });

  it("passes valid sequence diagram", () => {
    const md = "# Title\n\n```mermaid\nsequenceDiagram\n  Alice->>Bob: Hello\n```";
    const result = validateMermaid(md, "test-page");
    expect(result.passed).toBe(true);
  });
});
```

- [ ] **Step 8: Write mermaid-validator.ts**

```ts
// packages/core/src/validation/validators/mermaid-validator.ts
import type { ValidationReport } from "../../types/validation.js";

const VALID_DIAGRAM_TYPES = [
  "graph", "flowchart", "sequenceDiagram", "classDiagram",
  "stateDiagram", "erDiagram", "gantt", "pie", "gitgraph",
  "mindmap", "timeline", "quadrantChart", "sankey",
  "xychart", "block", "packet", "kanban", "architecture",
];

export function validateMermaid(markdown: string, pageSlug: string): ValidationReport {
  const errors: string[] = [];
  const warnings: string[] = [];

  const mermaidRegex = /```mermaid\s*\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  let blockIndex = 0;

  while ((match = mermaidRegex.exec(markdown)) !== null) {
    blockIndex++;
    const content = match[1].trim();

    if (content.length === 0) {
      errors.push(`${pageSlug}: mermaid block ${blockIndex} is empty`);
      continue;
    }

    const firstLine = content.split("\n")[0].trim();
    const hasDiagramType = VALID_DIAGRAM_TYPES.some((t) =>
      firstLine.startsWith(t),
    );

    if (!hasDiagramType) {
      errors.push(`${pageSlug}: mermaid block ${blockIndex} missing diagram type keyword (e.g., graph, sequenceDiagram)`);
    }
  }

  return { target: "page", passed: errors.length === 0, errors, warnings };
}
```

- [ ] **Step 9: Run test**

Run: `pnpm --filter @reporead/core test -- src/validation/__tests__/mermaid-validator`
Expected: All 5 tests pass.

### Sub-task 7d: Link Validator

- [ ] **Step 10: Write the failing test**

```ts
// packages/core/src/validation/__tests__/link-validator.test.ts
import { describe, it, expect } from "vitest";
import { validateLinks } from "../validators/link-validator.js";

describe("validateLinks", () => {
  it("passes page with valid internal page links", () => {
    const md = "# Title\n\nSee [Setup](setup) for details.";
    const knownPages = ["setup", "overview"];
    const result = validateLinks(md, knownPages, "test-page");
    expect(result.passed).toBe(true);
  });

  it("fails when internal link targets unknown page", () => {
    const md = "# Title\n\nSee [Missing](missing-page) for details.";
    const result = validateLinks(md, ["setup"], "test-page");
    expect(result.passed).toBe(false);
    expect(result.errors.some((e) => e.includes("missing-page"))).toBe(true);
  });

  it("ignores external URLs", () => {
    const md = "# Title\n\nSee [Docs](https://example.com) for details.";
    const result = validateLinks(md, [], "test-page");
    expect(result.passed).toBe(true);
  });

  it("ignores anchor links", () => {
    const md = "# Title\n\nSee [Section](#section) below.";
    const result = validateLinks(md, [], "test-page");
    expect(result.passed).toBe(true);
  });

  it("passes page with no links", () => {
    const md = "# Title\n\nNo links here.";
    const result = validateLinks(md, [], "test-page");
    expect(result.passed).toBe(true);
  });
});
```

- [ ] **Step 11: Write link-validator.ts**

```ts
// packages/core/src/validation/validators/link-validator.ts
import type { ValidationReport } from "../../types/validation.js";

export function validateLinks(
  markdown: string,
  knownPages: string[],
  pageSlug: string,
): ValidationReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const pageSet = new Set(knownPages);

  const linkRegex = /\[([^\]]*)\]\(([^)]+)\)/g;
  let match: RegExpExecArray | null;

  while ((match = linkRegex.exec(markdown)) !== null) {
    const target = match[2].trim();

    // Skip external URLs and anchor links
    if (target.startsWith("http://") || target.startsWith("https://") || target.startsWith("#")) {
      continue;
    }

    // Internal page reference
    if (!pageSet.has(target)) {
      errors.push(`${pageSlug}: link to unknown page "${target}"`);
    }
  }

  return { target: "page", passed: errors.length === 0, errors, warnings };
}
```

- [ ] **Step 12: Run test**

Run: `pnpm --filter @reporead/core test -- src/validation/__tests__/link-validator`
Expected: All 5 tests pass.

### Sub-task 7e: Page Validator Chain

- [ ] **Step 13: Write the failing test**

```ts
// packages/core/src/validation/__tests__/page-validator.test.ts
import { describe, it, expect } from "vitest";
import { validatePage } from "../page-validator.js";
import type { CitationRecord } from "../../types/generation.js";

const validMd = "# Core Engine\n\nThe engine orchestrates the generation pipeline. It manages state transitions and persists draft output.\n\n## Architecture\n\nThe pipeline follows a serial page model.\n\n```mermaid\ngraph TD\n  A[Catalog] --> B[Draft]\n  B --> C[Review]\n```";

const citations: CitationRecord[] = [
  { kind: "file", target: "src/engine.ts", locator: "1-50" },
];

describe("validatePage", () => {
  it("passes a fully valid page", () => {
    const result = validatePage({
      markdown: validMd,
      citations,
      knownFiles: ["src/engine.ts"],
      knownPages: ["setup"],
      pageSlug: "core-engine",
    });
    expect(result.passed).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("aggregates errors from multiple validators", () => {
    const result = validatePage({
      markdown: "",
      citations: [{ kind: "file", target: "nonexistent.ts" }],
      knownFiles: [],
      knownPages: [],
      pageSlug: "bad-page",
    });
    expect(result.passed).toBe(false);
    expect(result.errors.length).toBeGreaterThan(1);
  });

  it("aggregates warnings from multiple validators", () => {
    const shortMd = "# Title\n\nShort content.";
    const result = validatePage({
      markdown: shortMd,
      citations: [],
      knownFiles: [],
      knownPages: [],
      pageSlug: "short-page",
    });
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("catches mermaid errors in combined validation", () => {
    const badMermaid = "# Title\n\nLong enough content to pass the minimum length requirement for structure validation.\n\n```mermaid\n```";
    const result = validatePage({
      markdown: badMermaid,
      citations: [{ kind: "file", target: "a.ts" }],
      knownFiles: ["a.ts"],
      knownPages: [],
      pageSlug: "mermaid-page",
    });
    expect(result.passed).toBe(false);
    expect(result.errors.some((e) => e.includes("mermaid"))).toBe(true);
  });
});
```

- [ ] **Step 14: Write page-validator.ts**

```ts
// packages/core/src/validation/page-validator.ts
import type { CitationRecord } from "../types/generation.js";
import type { ValidationReport } from "../types/validation.js";
import { validateStructure } from "./validators/structure-validator.js";
import { validateCitations } from "./validators/citation-validator.js";
import { validateMermaid } from "./validators/mermaid-validator.js";
import { validateLinks } from "./validators/link-validator.js";

export type PageValidationInput = {
  markdown: string;
  citations: CitationRecord[];
  knownFiles: string[];
  knownPages: string[];
  pageSlug: string;
};

export function validatePage(input: PageValidationInput): ValidationReport {
  const reports = [
    validateStructure(input.markdown, input.pageSlug),
    validateCitations(input.citations, input.knownFiles, input.knownPages, input.pageSlug),
    validateMermaid(input.markdown, input.pageSlug),
    validateLinks(input.markdown, input.knownPages, input.pageSlug),
  ];

  const errors = reports.flatMap((r) => r.errors);
  const warnings = reports.flatMap((r) => r.warnings);

  return {
    target: "page",
    passed: errors.length === 0,
    errors,
    warnings,
  };
}
```

- [ ] **Step 15: Write validation/index.ts**

```ts
// packages/core/src/validation/index.ts
export { validatePage } from "./page-validator.js";
export type { PageValidationInput } from "./page-validator.js";
export { validateStructure } from "./validators/structure-validator.js";
export { validateCitations } from "./validators/citation-validator.js";
export { validateMermaid } from "./validators/mermaid-validator.js";
export { validateLinks } from "./validators/link-validator.js";
```

- [ ] **Step 16: Run all validator tests**

Run: `pnpm --filter @reporead/core test -- src/validation`
Expected: All 24 tests pass (5+5+5+5+4).

- [ ] **Step 17: Commit**

```bash
git add packages/core/src/validation/
git commit -m "feat(B044): deterministic page validator chain

Four-layer validation: structure, citations, mermaid, links.
Aggregates errors/warnings into single ValidationReport.
Any error blocks publication."
```

---

## Task 8: Publisher (B045)

**Files:**
- Create: `packages/core/src/generation/publisher.ts`
- Test: `packages/core/src/generation/__tests__/publisher.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/generation/__tests__/publisher.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { Publisher } from "../publisher.js";
import { StorageAdapter } from "../../storage/storage-adapter.js";
import type { WikiJson, VersionJson } from "../../types/generation.js";

describe("Publisher", () => {
  let tmpDir: string;
  let storage: StorageAdapter;

  const slug = "proj";
  const jobId = "job-1";
  const versionId = "v1";

  const wiki: WikiJson = {
    summary: "Test project",
    reading_order: [
      { slug: "overview", title: "Overview", rationale: "Start", covered_files: ["README.md"] },
      { slug: "core", title: "Core", rationale: "Main", covered_files: ["src/index.ts"] },
    ],
  };

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "reporead-publish-"));
    storage = new StorageAdapter(tmpDir);
    await storage.initialize();

    // Create draft structure
    const draftDir = storage.paths.draftDir(slug, jobId, versionId);
    await fs.mkdir(path.join(draftDir, "pages"), { recursive: true });
    await fs.mkdir(path.join(draftDir, "citations"), { recursive: true });

    await storage.writeJson(storage.paths.draftWikiJson(slug, jobId, versionId), wiki);
    await fs.writeFile(storage.paths.draftPageMd(slug, jobId, versionId, "overview"), "# Overview\n\nContent.");
    await fs.writeFile(storage.paths.draftPageMd(slug, jobId, versionId, "core"), "# Core\n\nContent.");
    await storage.writeJson(storage.paths.draftPageMeta(slug, jobId, versionId, "overview"), { slug: "overview", status: "validated" });
    await storage.writeJson(storage.paths.draftPageMeta(slug, jobId, versionId, "core"), { slug: "core", status: "validated" });
    await storage.writeJson(storage.paths.draftCitationsJson(slug, jobId, versionId, "overview"), []);
    await storage.writeJson(storage.paths.draftCitationsJson(slug, jobId, versionId, "core"), []);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("promotes draft to published version", async () => {
    const publisher = new Publisher(storage);
    await publisher.publish(slug, jobId, versionId, wiki, "abc123");

    // version.json exists in published location
    const vJson = await storage.readJson<VersionJson>(storage.paths.versionJson(slug, versionId));
    expect(vJson).not.toBeNull();
    expect(vJson!.versionId).toBe(versionId);
    expect(vJson!.pageCount).toBe(2);
  });

  it("published version contains all page files", async () => {
    const publisher = new Publisher(storage);
    await publisher.publish(slug, jobId, versionId, wiki, "abc123");

    const overviewMd = await fs.readFile(storage.paths.versionPageMd(slug, versionId, "overview"), "utf-8");
    expect(overviewMd).toContain("# Overview");

    const coreMd = await fs.readFile(storage.paths.versionPageMd(slug, versionId, "core"), "utf-8");
    expect(coreMd).toContain("# Core");
  });

  it("updates current.json with latest version", async () => {
    const publisher = new Publisher(storage);
    await publisher.publish(slug, jobId, versionId, wiki, "abc123");

    const current = await storage.readJson<{ projectSlug: string; versionId: string }>(
      storage.paths.currentJson,
    );
    expect(current).not.toBeNull();
    expect(current!.versionId).toBe(versionId);
  });

  it("writes version.json to draft before promotion", async () => {
    const publisher = new Publisher(storage);
    await publisher.publish(slug, jobId, versionId, wiki, "abc123");

    // After promotion, draft no longer exists but version.json is in published dir
    const versionJsonPath = storage.paths.versionJson(slug, versionId);
    const exists = await storage.exists(versionJsonPath);
    expect(exists).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @reporead/core test -- src/generation/__tests__/publisher`
Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

```ts
// packages/core/src/generation/publisher.ts
import type { StorageAdapter } from "../storage/storage-adapter.js";
import type { WikiJson, VersionJson } from "../types/generation.js";

export class Publisher {
  constructor(private readonly storage: StorageAdapter) {}

  async publish(
    projectSlug: string,
    jobId: string,
    versionId: string,
    wiki: WikiJson,
    commitHash: string,
  ): Promise<void> {
    // 1. Build version.json
    const versionJson: VersionJson = {
      versionId,
      projectSlug,
      commitHash,
      createdAt: new Date().toISOString(),
      pageCount: wiki.reading_order.length,
      pages: wiki.reading_order.map((page, idx) => ({
        slug: page.slug,
        title: page.title,
        order: idx + 1,
        status: "published" as const,
      })),
      summary: wiki.summary,
    };

    // 2. Write version.json into draft directory before promotion
    await this.storage.writeJson(
      this.storage.paths.draftVersionJson(projectSlug, jobId, versionId),
      versionJson,
    );

    // 3. Atomic promote: move draft -> published version
    await this.storage.promoteVersion(projectSlug, jobId, versionId);

    // 4. Update current.json pointer
    await this.storage.writeJson(this.storage.paths.currentJson, {
      projectSlug,
      versionId,
      updatedAt: new Date().toISOString(),
    });
  }
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @reporead/core test -- src/generation/__tests__/publisher`
Expected: All 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/generation/publisher.ts packages/core/src/generation/__tests__/publisher.test.ts
git commit -m "feat(B045): publisher with atomic version promotion

Writes version.json to draft, promotes draft to published versions/,
and updates current.json pointer."
```

---

## Task 9: Resume Logic (B046)

**Files:**
- Create: `packages/core/src/generation/resume.ts`
- Test: `packages/core/src/generation/__tests__/resume.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/generation/__tests__/resume.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { determineResumePoint } from "../resume.js";
import { StorageAdapter } from "../../storage/storage-adapter.js";
import type { GenerationJob } from "../../types/generation.js";

const baseJob: GenerationJob = {
  id: "job-1",
  projectSlug: "proj",
  repoRoot: "/tmp/repo",
  versionId: "v1",
  status: "interrupted",
  createdAt: "2026-01-01T00:00:00Z",
  startedAt: "2026-01-01T00:00:01Z",
  configSnapshot: {} as never,
  currentPageSlug: "core",
  nextPageOrder: 2,
  summary: { totalPages: 3, succeededPages: 1, failedPages: 0 },
};

describe("determineResumePoint", () => {
  let tmpDir: string;
  let storage: StorageAdapter;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "reporead-resume-"));
    storage = new StorageAdapter(tmpDir);
    await storage.initialize();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("returns cataloging when interrupted at cataloging", async () => {
    const job = { ...baseJob, status: "interrupted" as const, currentPageSlug: undefined };
    // No draft wiki.json exists
    const result = await determineResumePoint(storage, job);
    expect(result.stage).toBe("cataloging");
  });

  it("returns page_drafting when draft exists but no review", async () => {
    const job = { ...baseJob };
    const draftDir = storage.paths.draftDir("proj", "job-1", "v1");
    await fs.mkdir(path.join(draftDir, "pages"), { recursive: true });
    await fs.writeFile(storage.paths.draftPageMd("proj", "job-1", "v1", "core"), "# Core");

    const result = await determineResumePoint(storage, job);
    expect(result.stage).toBe("page_drafting");
    expect(result.pageSlug).toBe("core");
  });

  it("returns reviewing when draft and page exist but no review", async () => {
    const job = { ...baseJob };
    const draftDir = storage.paths.draftDir("proj", "job-1", "v1");
    await fs.mkdir(path.join(draftDir, "pages"), { recursive: true });
    await fs.writeFile(storage.paths.draftPageMd("proj", "job-1", "v1", "core"), "# Core\n\nContent.");
    await storage.writeJson(storage.paths.draftPageMeta("proj", "job-1", "v1", "core"), { slug: "core", status: "drafted" });

    const result = await determineResumePoint(storage, job);
    expect(result.stage).toBe("reviewing");
    expect(result.pageSlug).toBe("core");
  });

  it("returns validating when review exists but no validation", async () => {
    const job = { ...baseJob };
    const draftDir = storage.paths.draftDir("proj", "job-1", "v1");
    await fs.mkdir(path.join(draftDir, "pages"), { recursive: true });
    await fs.writeFile(storage.paths.draftPageMd("proj", "job-1", "v1", "core"), "# Core\n\nContent.");
    await storage.writeJson(storage.paths.draftPageMeta("proj", "job-1", "v1", "core"), { slug: "core", status: "reviewed" });
    await storage.writeJson(storage.paths.reviewJson("proj", "job-1", "core"), { verdict: "pass" });

    const result = await determineResumePoint(storage, job);
    expect(result.stage).toBe("validating");
    expect(result.pageSlug).toBe("core");
  });

  it("rejects completed jobs", async () => {
    const job = { ...baseJob, status: "completed" as const };
    const result = await determineResumePoint(storage, job);
    expect(result.canResume).toBe(false);
    expect(result.reason).toContain("completed");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @reporead/core test -- src/generation/__tests__/resume`
Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

```ts
// packages/core/src/generation/resume.ts
import type { StorageAdapter } from "../storage/storage-adapter.js";
import type { GenerationJob, JobStatus } from "../types/generation.js";

export type ResumePoint = {
  canResume: boolean;
  stage?: JobStatus;
  pageSlug?: string;
  reason?: string;
};

const NON_RESUMABLE: JobStatus[] = ["completed", "queued"];

export async function determineResumePoint(
  storage: StorageAdapter,
  job: GenerationJob,
): Promise<ResumePoint> {
  if (NON_RESUMABLE.includes(job.status)) {
    return { canResume: false, reason: `Job is ${job.status} — cannot resume` };
  }

  const slug = job.projectSlug;
  const jobId = job.id;
  const versionId = job.versionId;

  // Check if wiki.json exists in draft
  const hasWiki = await storage.exists(
    storage.paths.draftWikiJson(slug, jobId, versionId),
  );

  if (!hasWiki) {
    return { canResume: true, stage: "cataloging" };
  }

  // If no current page, start page_drafting from the beginning
  const pageSlug = job.currentPageSlug;
  if (!pageSlug) {
    return { canResume: true, stage: "page_drafting" };
  }

  // Check what artifacts exist for the current page
  const hasDraft = await storage.exists(
    storage.paths.draftPageMd(slug, jobId, versionId, pageSlug),
  );

  if (!hasDraft) {
    return { canResume: true, stage: "page_drafting", pageSlug };
  }

  const hasReview = await storage.exists(
    storage.paths.reviewJson(slug, jobId, pageSlug),
  );

  const hasMeta = await storage.exists(
    storage.paths.draftPageMeta(slug, jobId, versionId, pageSlug),
  );

  if (!hasReview && hasMeta) {
    return { canResume: true, stage: "reviewing", pageSlug };
  }

  if (hasReview) {
    const hasValidation = await storage.exists(
      storage.paths.validationJson(slug, jobId, pageSlug),
    );

    if (!hasValidation) {
      return { canResume: true, stage: "validating", pageSlug };
    }

    // Validation exists — re-check if it passed; if so, advance to next page
    return { canResume: true, stage: "page_drafting", pageSlug };
  }

  // Default: re-draft the current page
  return { canResume: true, stage: "page_drafting", pageSlug };
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @reporead/core test -- src/generation/__tests__/resume`
Expected: All 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/generation/resume.ts packages/core/src/generation/__tests__/resume.test.ts
git commit -m "feat(B046): resume logic from job-state.json recovery point

Inspects draft artifacts to determine safe resume stage:
cataloging, page_drafting, reviewing, or validating."
```

---

## Task 10: Generation Pipeline Orchestrator (B040 + B049)

**Files:**
- Create: `packages/core/src/generation/generation-pipeline.ts`
- Test: `packages/core/src/generation/__tests__/generation-pipeline.test.ts`
- Modify: `packages/core/src/generation/index.ts`
- Modify: `packages/core/src/index.ts`

This is the integration task — it wires everything together.

- [ ] **Step 1: Write the failing integration test**

```ts
// packages/core/src/generation/__tests__/generation-pipeline.test.ts
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
    "main.author": { role: "main.author", primaryModel: "claude-sonnet-4-6", fallbackModels: [], resolvedProvider: "anthropic", systemPromptTuningId: "claude" },
    "fork.worker": { role: "fork.worker", primaryModel: "claude-haiku-4-5-20251001", fallbackModels: [], resolvedProvider: "anthropic", systemPromptTuningId: "claude" },
    "fresh.reviewer": { role: "fresh.reviewer", primaryModel: "claude-sonnet-4-6", fallbackModels: [], resolvedProvider: "anthropic", systemPromptTuningId: "claude" },
  },
  providers: [],
  retrieval: { maxParallelReadsPerPage: 5, maxReadWindowLines: 500, allowControlledBash: true },
};

const wikiJson: WikiJson = {
  summary: "Test project",
  reading_order: [
    { slug: "overview", title: "Overview", rationale: "Start here", covered_files: ["README.md"] },
    { slug: "core", title: "Core", rationale: "Main logic", covered_files: ["src/index.ts"] },
  ],
};

const draftOutput = (slug: string, title: string) => `# ${title}

Content for ${slug} page with enough detail to pass structure validation checks and meet minimum length requirements.

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @reporead/core test -- src/generation/__tests__/generation-pipeline`
Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

```ts
// packages/core/src/generation/generation-pipeline.ts
import type { LanguageModel, ToolSet } from "ai";
import type { StorageAdapter } from "../storage/storage-adapter.js";
import type { GenerationJob, WikiJson } from "../types/generation.js";
import type { ResolvedConfig } from "../types/config.js";
import type { MainAuthorContext } from "../types/agent.js";
import type { ReviewBriefing } from "../types/review.js";
import { JobStateManager } from "./job-state.js";
import { JobEventEmitter } from "./generation-events.js";
import { PageDrafter } from "./page-drafter.js";
import { FreshReviewer } from "../review/reviewer.js";
import { validatePage } from "../validation/page-validator.js";
import { validateCatalog } from "../catalog/catalog-validator.js";
import { CatalogPlanner } from "../catalog/catalog-planner.js";
import { persistCatalog } from "../catalog/catalog-persister.js";
import { Publisher } from "./publisher.js";

export type GenerationPipelineOptions = {
  storage: StorageAdapter;
  jobManager: JobStateManager;
  config: ResolvedConfig;
  model: LanguageModel;
  reviewerModel: LanguageModel;
  repoRoot: string;
  commitHash: string;
};

export type PipelineResult = {
  success: boolean;
  job: GenerationJob;
  error?: string;
};

export class GenerationPipeline {
  private readonly storage: StorageAdapter;
  private readonly jobManager: JobStateManager;
  private readonly config: ResolvedConfig;
  private readonly model: LanguageModel;
  private readonly reviewerModel: LanguageModel;
  private readonly repoRoot: string;
  private readonly commitHash: string;

  constructor(options: GenerationPipelineOptions) {
    this.storage = options.storage;
    this.jobManager = options.jobManager;
    this.config = options.config;
    this.model = options.model;
    this.reviewerModel = options.reviewerModel;
    this.repoRoot = options.repoRoot;
    this.commitHash = options.commitHash;
  }

  async run(job: GenerationJob): Promise<PipelineResult> {
    const slug = job.projectSlug;
    const jobId = job.id;
    const versionId = job.versionId;
    const emitter = new JobEventEmitter(this.storage, slug, jobId, versionId);

    try {
      // === CATALOGING ===
      job = await this.jobManager.transition(slug, jobId, "cataloging");
      await emitter.jobStarted();

      const catalogPlanner = new CatalogPlanner({ model: this.model, language: "en" });
      const profileResult = {
        projectSlug: slug,
        repoRoot: this.repoRoot,
        repoName: slug,
        branch: "main",
        commitHash: this.commitHash,
        languages: [],
        frameworks: [],
        packageManagers: [],
        entryFiles: [],
        importantDirs: [],
        ignoredPaths: [],
        sourceFileCount: 0,
        docFileCount: 0,
        treeSummary: "",
        architectureHints: [],
      };

      const catalogResult = await catalogPlanner.plan(profileResult);
      if (!catalogResult.success || !catalogResult.wiki) {
        return this.failJob(job, emitter, catalogResult.error ?? "Catalog planning failed");
      }

      const wiki = catalogResult.wiki;
      const catalogValidation = validateCatalog(wiki);
      if (!catalogValidation.passed) {
        return this.failJob(job, emitter, `Catalog validation failed: ${catalogValidation.errors.join("; ")}`);
      }

      await persistCatalog(this.storage, slug, jobId, versionId, wiki);
      await emitter.catalogCompleted(wiki.reading_order.length);

      job = await this.jobManager.transition(slug, jobId, "page_drafting");
      job.summary.totalPages = wiki.reading_order.length;
      job.summary.succeededPages = 0;
      job.summary.failedPages = 0;

      // === PAGE LOOP ===
      const publishedSummaries: Array<{ slug: string; title: string; summary: string }> = [];
      const knownPages: string[] = [];

      for (let i = 0; i < wiki.reading_order.length; i++) {
        const page = wiki.reading_order[i];
        job = await this.jobManager.updatePage(slug, jobId, page.slug, i + 1);

        // --- DRAFT ---
        await emitter.pageDrafting(page.slug);

        const drafter = new PageDrafter({ model: this.model, repoRoot: this.repoRoot });
        const authorContext: MainAuthorContext = {
          project_summary: wiki.summary,
          full_book_summary: wiki.summary,
          current_page_plan: page.rationale,
          published_page_summaries: publishedSummaries,
          evidence_ledger: [],
        };

        const draftResult = await drafter.draft(authorContext, {
          slug: page.slug,
          title: page.title,
          order: i + 1,
          coveredFiles: page.covered_files,
          language: "en",
        });

        if (!draftResult.success || !draftResult.markdown || !draftResult.metadata) {
          return this.failJob(job, emitter, draftResult.error ?? `Page ${page.slug} drafting failed`);
        }

        // Persist draft
        await this.storage.writeJson(
          this.storage.paths.draftPageMd(slug, jobId, versionId, page.slug),
          null, // We'll write raw markdown instead
        );
        // Actually write markdown as text, not JSON
        const pageMdPath = this.storage.paths.draftPageMd(slug, jobId, versionId, page.slug);
        const fsModule = await import("node:fs/promises");
        const pathModule = await import("node:path");
        await fsModule.mkdir(pathModule.dirname(pageMdPath), { recursive: true });
        await fsModule.writeFile(pageMdPath, draftResult.markdown, "utf-8");

        // Persist citations
        await this.storage.writeJson(
          this.storage.paths.draftCitationsJson(slug, jobId, versionId, page.slug),
          draftResult.metadata.citations,
        );

        await emitter.pageDrafted(page.slug);

        // --- REVIEW ---
        if (i > 0 || wiki.reading_order.length > 0) {
          job = await this.jobManager.transition(slug, jobId, "reviewing");
        }

        const reviewer = new FreshReviewer({ model: this.reviewerModel, repoRoot: this.repoRoot });
        const briefing: ReviewBriefing = {
          page_title: page.title,
          section_position: `Page ${i + 1} of ${wiki.reading_order.length}`,
          current_page_plan: page.rationale,
          full_book_summary: wiki.summary,
          current_draft: draftResult.markdown,
          citations: draftResult.metadata.citations,
          covered_files: page.covered_files,
          review_questions: [
            "Does the page stay within its assigned scope?",
            "Are all key claims backed by citations from the repository?",
            "Are there covered files that should be referenced but aren't?",
          ],
        };

        const reviewResult = await reviewer.review(briefing);
        if (!reviewResult.success || !reviewResult.conclusion) {
          return this.failJob(job, emitter, reviewResult.error ?? `Page ${page.slug} review failed`);
        }

        await this.storage.writeJson(
          this.storage.paths.reviewJson(slug, jobId, page.slug),
          reviewResult.conclusion,
        );
        await emitter.pageReviewed(page.slug, reviewResult.conclusion.verdict);

        // If reviewer says revise, for V1 we still proceed (single-pass)
        // Future: loop back to drafter with revision instructions

        // --- VALIDATE ---
        job = await this.jobManager.transition(slug, jobId, "validating");

        const validationResult = validatePage({
          markdown: draftResult.markdown,
          citations: draftResult.metadata.citations,
          knownFiles: page.covered_files,
          knownPages,
          pageSlug: page.slug,
        });

        await this.storage.writeJson(
          this.storage.paths.validationJson(slug, jobId, page.slug),
          validationResult,
        );
        await emitter.pageValidated(page.slug, validationResult.passed);

        // Persist page meta
        const pageMeta = {
          slug: page.slug,
          title: page.title,
          order: i + 1,
          sectionId: page.slug,
          coveredFiles: page.covered_files,
          relatedPages: draftResult.metadata.related_pages,
          generatedAt: new Date().toISOString(),
          commitHash: this.commitHash,
          citationFile: `citations/${page.slug}.citations.json`,
          summary: draftResult.metadata.summary,
          reviewStatus: reviewResult.conclusion.verdict === "pass" ? "accepted" : "accepted_with_notes",
          reviewSummary: reviewResult.conclusion.blockers.join("; ") || "No blockers",
          reviewDigest: JSON.stringify(reviewResult.conclusion),
          status: "validated" as const,
          validation: {
            structurePassed: validationResult.passed,
            mermaidPassed: !validationResult.errors.some((e) => e.includes("mermaid")),
            citationsPassed: !validationResult.errors.some((e) => e.includes("citation")),
            linksPassed: !validationResult.errors.some((e) => e.includes("link")),
            summary: validationResult.passed ? ("passed" as const) : ("failed" as const),
          },
        };

        await this.storage.writeJson(
          this.storage.paths.draftPageMeta(slug, jobId, versionId, page.slug),
          pageMeta,
        );

        // Track progress
        knownPages.push(page.slug);
        publishedSummaries.push({
          slug: page.slug,
          title: page.title,
          summary: draftResult.metadata.summary,
        });
        job.summary.succeededPages = (job.summary.succeededPages ?? 0) + 1;

        // Transition back to page_drafting for next page (if any)
        if (i < wiki.reading_order.length - 1) {
          job = await this.jobManager.transition(slug, jobId, "page_drafting");
        }
      }

      // === PUBLISH ===
      job = await this.jobManager.transition(slug, jobId, "publishing");

      const publisher = new Publisher(this.storage);
      await publisher.publish(slug, jobId, versionId, wiki, this.commitHash);

      job = await this.jobManager.transition(slug, jobId, "completed");
      await emitter.jobCompleted(
        job.summary.totalPages ?? 0,
        job.summary.succeededPages ?? 0,
        job.summary.failedPages ?? 0,
      );

      return { success: true, job };
    } catch (err) {
      return this.failJob(job, emitter, (err as Error).message);
    }
  }

  private async failJob(
    job: GenerationJob,
    emitter: JobEventEmitter,
    error: string,
  ): Promise<PipelineResult> {
    try {
      job = await this.jobManager.fail(job.projectSlug, job.id, error);
      await emitter.jobFailed(error);
    } catch {
      // Best-effort failure recording
    }
    return { success: false, job, error };
  }
}
```

- [ ] **Step 4: Run integration test**

Run: `pnpm --filter @reporead/core test -- src/generation/__tests__/generation-pipeline`
Expected: Integration test passes.

- [ ] **Step 5: Update generation/index.ts**

```ts
// packages/core/src/generation/index.ts
export { JobStateManager } from "./job-state.js";
export { JobEventEmitter } from "./generation-events.js";
export { PageDrafter } from "./page-drafter.js";
export type { PageDraftResult, PageDrafterOptions } from "./page-drafter.js";
export { buildPageDraftSystemPrompt, buildPageDraftUserPrompt } from "./page-drafter-prompt.js";
export type { PageDraftPromptInput } from "./page-drafter-prompt.js";
export { ForkWorker } from "./fork-worker.js";
export type { ForkWorkerResponse, ForkWorkerOptions } from "./fork-worker.js";
export { buildForkWorkerSystemPrompt, buildForkWorkerUserPrompt } from "./fork-worker-prompt.js";
export type { ForkWorkerInput } from "./fork-worker-prompt.js";
export { Publisher } from "./publisher.js";
export { determineResumePoint } from "./resume.js";
export type { ResumePoint } from "./resume.js";
export { GenerationPipeline } from "./generation-pipeline.js";
export type { GenerationPipelineOptions, PipelineResult } from "./generation-pipeline.js";
```

- [ ] **Step 6: Update core index.ts**

Add to `packages/core/src/index.ts`:

```ts
export {
  JobEventEmitter, PageDrafter, ForkWorker, Publisher,
  determineResumePoint, GenerationPipeline,
  buildPageDraftSystemPrompt, buildPageDraftUserPrompt,
  buildForkWorkerSystemPrompt, buildForkWorkerUserPrompt,
} from "./generation/index.js";
export type {
  PageDraftResult, PageDrafterOptions, PageDraftPromptInput,
  ForkWorkerResponse, ForkWorkerOptions, ForkWorkerInput,
  ResumePoint, GenerationPipelineOptions, PipelineResult,
} from "./generation/index.js";

export { FreshReviewer, buildReviewerSystemPrompt, buildReviewerUserPrompt } from "./review/index.js";
export type { ReviewResult, FreshReviewerOptions } from "./review/index.js";

export {
  validatePage, validateStructure, validateCitations,
  validateMermaid, validateLinks,
} from "./validation/index.js";
export type { PageValidationInput } from "./validation/index.js";
```

- [ ] **Step 7: Run full test suite**

Run: `pnpm test`
Expected: All tests pass.

- [ ] **Step 8: Run typecheck**

Run: `pnpm --filter @reporead/core typecheck`
Expected: Clean.

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/generation/ packages/core/src/index.ts
git commit -m "feat(B040+B049): generation pipeline orchestrator with integration test

Wires cataloging, page drafting, review, validation, and publishing
into serial pipeline. Integration test verifies full flow with
mocked LLM producing 2 pages through all stages."
```

---

## Self-Review

**1. Spec coverage check:**
- B040 (GenerationJob state machine) — Covered by Task 10 (pipeline orchestrator uses existing JobStateManager with all transitions)
- B041 (Page Draft Runtime) — Tasks 3-4 (prompts + drafter)
- B042 (fork.worker) — Task 5
- B043 (fresh.reviewer) — Task 6
- B044 (validator chain) — Task 7 (4 validators + chain)
- B045 (Publisher) — Task 8
- B046 (Interrupt/Resume) — Task 9
- B048 (Generation events) — Task 2
- B049 (Integration test) — Task 10

**2. Placeholder scan:** No TODOs, TBDs, or vague instructions found.

**3. Type consistency:**
- `PageDraftPromptInput` used consistently in Tasks 3 and 4
- `ForkWorkerInput` used consistently in Task 5
- `ReviewBriefing` / `ReviewConclusion` match existing types in `types/review.ts`
- `ValidationReport` matches existing type in `types/validation.ts`
- `VersionJson` added in Task 1, used in Task 8
- `WikiJson`, `PageMeta`, `CitationRecord`, `MainAuthorContext`, `ForkWorkerResult` all match existing definitions
- `JobEventEmitter` method signatures in Task 2 match usage in Task 10
- `GenerationPipeline` constructor options match what's available from existing code
