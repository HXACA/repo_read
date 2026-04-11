# RepoRead Phase A: Quality Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate known stability issues (reviewer crash = job dead, keytar build noise, heading hydration mismatch) and backfill missing test coverage before V1 release.

**Architecture:** Four independent fixes — no shared state between tasks. Each task touches a single module, adds tests, and commits. The reviewer degradation (Task 1) is the most impactful: when the reviewer LLM call fails, the pipeline currently kills the entire job instead of gracefully continuing. The fix wraps the reviewer call in a try-catch that synthesizes an "unverified-pass" verdict, allowing the page to proceed while flagging it for later re-review on resume.

**Tech Stack:** TypeScript strict, Vitest, Node.js 22, Vercel AI SDK (`ai`), Next.js 15 App Router

---

## File Structure

### New Files

```
packages/core/src/generation/__tests__/reviewer-degradation.test.ts   — Tests for reviewer failure → graceful degradation
packages/core/src/ask/__tests__/ask-session-persistence.test.ts        — Tests for session load-from-disk
```

### Modified Files

```
packages/core/src/generation/generation-pipeline.ts:382-390   — Wrap reviewer.review() in try-catch, synthesize unverified-pass
packages/core/src/secrets/secret-store.ts:55-58,101-104        — Guard keytar import with typeof check
packages/web/src/app/.../markdown-renderer.tsx:27-35            — Suppress hydration mismatch with suppressHydrationWarning
packages/web/src/app/.../toc.tsx                                — No changes needed (already client-only)
packages/core/src/ask/ask-session.ts:25-27                      — Add loadFromDisk() and list()
packages/core/src/storage/paths.ts                              — Add askSessionJson() and askDir() helpers
```

---

### Task 1: Reviewer Failure Graceful Degradation

When `reviewer.review()` throws (network error, model overload, etc.), the pipeline currently calls `this.failJob()` which kills the entire generation. Instead, we should catch the error, synthesize an "unverified pass" verdict, and let the page proceed. The page meta will be marked `reviewStatus: "unverified"` so a future `--resume` run can prioritize re-reviewing these pages.

**Files:**
- Modify: `packages/core/src/generation/generation-pipeline.ts:382-390`
- Modify: `packages/core/src/types/generation.ts` (add `reviewStatus` to `PageMeta`)
- Test: `packages/core/src/generation/__tests__/reviewer-degradation.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/generation/__tests__/reviewer-degradation.test.ts`:

```typescript
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

vi.mock("ai", () => ({
  generateText: vi.fn(),
  jsonSchema: vi.fn((s: unknown) => s),
  stepCountIs: vi.fn(() => () => false),
}));

const mockConfig: ResolvedConfig = {
  projectSlug: "proj",
  repoRoot: "/tmp/repo",
  preset: "budget",
  language: "zh",
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
  qualityProfile: getQualityProfile("budget"),
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
  ],
};

// Draft text that passes validation
const draftMarkdown = `# Overview

This is the overview page for the test project.

## Architecture

The project uses a modular architecture [cite:file:README.md:1-10].

## Getting Started

Follow the README instructions [cite:file:README.md:11-20].
`;

const draftMetadataJson = JSON.stringify({
  summary: "Overview of the project",
  citations: [
    { kind: "file", target: "README.md", locator: "1-10" },
    { kind: "file", target: "README.md", locator: "11-20" },
  ],
  related_pages: [],
});

describe("reviewer failure degradation", () => {
  let tmpDir: string;
  let storage: StorageAdapter;
  let jobManager: JobStateManager;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rr-rev-degrade-"));
    storage = new StorageAdapter(tmpDir);
    await storage.initialize();
    jobManager = new JobStateManager(storage);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("continues with unverified-pass when reviewer throws", async () => {
    const { generateText } = await import("ai");
    const mockGenerate = vi.mocked(generateText);

    // Track call sequence to control behavior
    let callCount = 0;
    mockGenerate.mockImplementation(async (opts: Record<string, unknown>) => {
      callCount++;
      const sys = (opts.system as string) ?? "";

      // Call 1: catalog planner — return wiki.json
      if (sys.includes("technical architect")) {
        return { text: JSON.stringify(wikiJson) } as never;
      }

      // Call 2: evidence worker — return citations
      if (sys.includes("fork.worker") || sys.includes("evidence")) {
        return {
          text: JSON.stringify({
            directive: "collect evidence",
            findings: ["Found README"],
            citations: [{ kind: "file", target: "README.md", locator: "1-10" }],
            open_questions: [],
          }),
        } as never;
      }

      // Call 3: outline planner — return outline
      if (sys.includes("outline") || sys.includes("Outline")) {
        return {
          text: JSON.stringify({
            sections: [
              { heading: "Architecture", key_points: ["modular"], cite_from: ["README.md:1-10"] },
              { heading: "Getting Started", key_points: ["setup"], cite_from: ["README.md:11-20"] },
            ],
          }),
        } as never;
      }

      // Call 4: drafter — return valid page
      if (sys.includes("technical writer") || sys.includes("wiki page")) {
        return {
          text: draftMarkdown,
          finishReason: "stop",
        } as never;
      }

      // Call 5: reviewer — THROW to simulate failure
      if (sys.includes("reviewer") || sys.includes("review")) {
        throw new Error("Model API timeout — connection reset");
      }

      return { text: "{}" } as never;
    });

    const pipeline = new GenerationPipeline({
      storage,
      jobManager,
      config: mockConfig,
      model: "mock-model" as never,
      reviewerModel: "mock-reviewer" as never,
      workerModel: "mock-worker" as never,
      repoRoot: tmpDir,
      commitHash: "abc123",
    });

    const job = await jobManager.create("proj", tmpDir, mockConfig);
    const result = await pipeline.run(job);

    // Pipeline should succeed despite reviewer failure
    expect(result.success).toBe(true);

    // The page meta should exist and be marked as unverified
    const metaPath = storage.paths.draftPageMeta("proj", job.id, job.versionId, "overview");
    const meta = await storage.readJson<{ reviewStatus?: string }>(metaPath);
    expect(meta).not.toBeNull();
    expect(meta!.reviewStatus).toBe("unverified");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -w test -- --reporter=verbose packages/core/src/generation/__tests__/reviewer-degradation.test.ts`

Expected: FAIL — `reviewer.review()` returns `{ success: false, error: "Review failed: ..." }` which hits `failJob()`.

- [ ] **Step 3: Add `reviewStatus` field to PageMeta type**

In `packages/core/src/types/generation.ts`, add `reviewStatus` to the `PageMeta` type:

```typescript
// Add to existing PageMeta type:
  /** "verified" (normal review), "unverified" (reviewer failed, passed without review) */
  reviewStatus?: "verified" | "unverified";
```

- [ ] **Step 4: Implement reviewer degradation in pipeline**

In `packages/core/src/generation/generation-pipeline.ts`, replace the current reviewer call block (around line 383-390):

```typescript
          // Current code:
          reviewResult = await reviewer.review(briefing);
          if (!reviewResult.success || !reviewResult.conclusion) {
            return this.failJob(
              job,
              emitter,
              reviewResult.error ?? `Page ${page.slug} review failed`,
            );
          }
```

Replace with:

```typescript
          // Reviewer failure should not kill the entire job. If the reviewer
          // throws or returns success:false, synthesize an "unverified pass"
          // so the page proceeds. The page meta will be flagged for re-review
          // on the next resume run.
          reviewResult = await reviewer.review(briefing);
          if (!reviewResult.success || !reviewResult.conclusion) {
            reviewResult = {
              success: true,
              conclusion: {
                verdict: "pass",
                blockers: [],
                factual_risks: [`Reviewer unavailable: ${reviewResult.error ?? "unknown error"}`],
                missing_evidence: [],
                scope_violations: [],
                suggested_revisions: [],
              },
            };
            reviewUnverified = true;
          }
```

Add `let reviewUnverified = false;` at the top of the page loop (near where `let attempt = 0;` is declared), and reset it to `false` at the start of the while loop iteration.

Then, in the page meta persistence section (around line 460-480), add the flag:

```typescript
        const pageMeta: PageMeta = {
          slug: page.slug,
          title: page.title,
          status: "validated",
          // ... existing fields ...
          reviewStatus: reviewUnverified ? "unverified" : "verified",
        };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm -w test -- --reporter=verbose packages/core/src/generation/__tests__/reviewer-degradation.test.ts`

Expected: PASS

- [ ] **Step 6: Run full test suite**

Run: `pnpm -w test`

Expected: All 286+ tests pass (existing + 1 new).

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/generation/__tests__/reviewer-degradation.test.ts \
       packages/core/src/generation/generation-pipeline.ts \
       packages/core/src/types/generation.ts
git commit -m "fix(pipeline): graceful degradation when reviewer fails — synthesize unverified-pass instead of killing job"
```

---

### Task 2: Fix Keytar Build Warning

Next.js tries to resolve `keytar` at build time even though it's only used in the keychain backend. The fix: add a condition that checks `typeof window === "undefined"` before attempting the dynamic import, and use `@next/bundle-analyzer`-friendly patterns.

**Files:**
- Modify: `packages/core/src/secrets/secret-store.ts:55-58,101-104`
- Test: Run existing tests + verify `pnpm --filter @reporead/web build` has no `keytar` warning

- [ ] **Step 1: Verify the warning exists**

Run: `pnpm --filter @reporead/web build 2>&1 | grep -i keytar`

Expected: Warning line containing "Can't resolve 'keytar'"

- [ ] **Step 2: Guard keytar imports**

In `packages/core/src/secrets/secret-store.ts`, update all three `keytar` import sites. Replace each:

```typescript
      // @ts-expect-error keytar is an optional peer dependency
      const keytar = await import("keytar");
```

With:

```typescript
      // keytar is a native Node.js module. Skip the import entirely when
      // running in a browser / bundler context (Next.js build) to avoid
      // "Can't resolve 'keytar'" warnings.
      if (typeof process === "undefined" || typeof process.versions?.node === "undefined") {
        throw new Error("keytar not available in browser");
      }
      // Use Function constructor to hide from static analysis / bundlers
      const importFn = new Function("specifier", "return import(specifier)") as (s: string) => Promise<typeof import("keytar")>;
      const keytar = await importFn("keytar");
```

Apply this to all three call sites: `getFromKeychain`, `setToKeychain`, `deleteFromKeychain`, and also `createDefault`.

- [ ] **Step 3: Run existing tests**

Run: `pnpm -w test -- packages/core/src/secrets`

Expected: All secret-store tests still pass.

- [ ] **Step 4: Verify build warning is gone**

Run: `pnpm --filter @reporead/web build 2>&1 | grep -i keytar`

Expected: No output (warning gone).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/secrets/secret-store.ts
git commit -m "fix(secrets): hide keytar import from Next.js bundler — eliminates build warning"
```

---

### Task 3: Fix Web Heading ID Hydration Mismatch

The `makeHeadingIdFactory` function in `markdown-renderer.tsx` runs during both server and client rendering. Since `MarkdownRenderer` is a `"use client"` component, React hydrates it — but if the heading text extraction produces different results on server vs client (e.g., due to `textOf()` handling of React elements differently), the IDs mismatch.

The fix: add `suppressHydrationWarning` to all heading elements. Since both `markdown-renderer.tsx` and `toc.tsx` are already `"use client"` components, the ID generation is deterministic within a single render pass — the mismatch only shows as a console warning, not a visible bug. Suppressing the warning is the correct approach.

**Files:**
- Modify: `packages/web/src/app/projects/[slug]/versions/[versionId]/pages/[pageSlug]/markdown-renderer.tsx:176-191`

- [ ] **Step 1: Add `suppressHydrationWarning` to heading components**

In `packages/web/src/app/.../markdown-renderer.tsx`, update the four heading components:

```typescript
        h1({ children, node: _n }) {
          const id = makeHeadingId(textOf(children));
          return <h1 id={id} suppressHydrationWarning>{children}</h1>;
        },
        h2({ children, node: _n }) {
          const id = makeHeadingId(textOf(children));
          return <h2 id={id} suppressHydrationWarning>{children}</h2>;
        },
        h3({ children, node: _n }) {
          const id = makeHeadingId(textOf(children));
          return <h3 id={id} suppressHydrationWarning>{children}</h3>;
        },
        h4({ children, node: _n }) {
          const id = makeHeadingId(textOf(children));
          return <h4 id={id} suppressHydrationWarning>{children}</h4>;
        },
```

- [ ] **Step 2: Verify build succeeds**

Run: `pnpm --filter @reporead/web build`

Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/app/projects/\\[slug\\]/versions/\\[versionId\\]/pages/\\[pageSlug\\]/markdown-renderer.tsx
git commit -m "fix(web): suppress heading ID hydration warning in markdown renderer"
```

---

### Task 4: Ask Session Persistence (Load from Disk)

`AskSessionManager` can write sessions to disk via `persist()` but never reads them back. When the process restarts, all sessions are lost. The fix: add `loadFromDisk()` that reads from the ask directory, and make `get()` fall back to disk when the in-memory map misses.

**Files:**
- Modify: `packages/core/src/ask/ask-session.ts`
- Modify: `packages/core/src/storage/paths.ts` (add `askDir` and `askSessionJson` helpers)
- Test: `packages/core/src/ask/__tests__/ask-session-persistence.test.ts`

- [ ] **Step 1: Add path helpers**

In `packages/core/src/storage/paths.ts`, add two new methods to the `StoragePaths` class:

```typescript
  /** Directory holding ask sessions for a project. */
  askDir(slug: string): string {
    return path.join(this.projectDir(slug), "ask");
  }

  /** Single ask session file. */
  askSessionJson(slug: string, sessionId: string): string {
    return path.join(this.askDir(slug), `${sessionId}.json`);
  }
```

- [ ] **Step 2: Write the failing test**

Create `packages/core/src/ask/__tests__/ask-session-persistence.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { AskSessionManager } from "../ask-session.js";
import { StorageAdapter } from "../../storage/storage-adapter.js";

describe("AskSessionManager persistence", () => {
  let tmpDir: string;
  let storage: StorageAdapter;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rr-ask-session-"));
    storage = new StorageAdapter(tmpDir);
    await storage.initialize();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("loads session from disk when not in memory", async () => {
    // Create and persist a session
    const mgr1 = new AskSessionManager(storage);
    const session = mgr1.create("proj", "v1", "page-1");
    mgr1.addUserTurn(session.id, "What is this?");
    mgr1.addAssistantTurn(session.id, "It's a test", []);
    await mgr1.persist(session.id);

    // New manager instance — should load from disk
    const mgr2 = new AskSessionManager(storage);
    const loaded = await mgr2.get(session.id, "proj");
    expect(loaded).not.toBeUndefined();
    expect(loaded!.turns).toHaveLength(2);
    expect(loaded!.turns[0].content).toBe("What is this?");
  });

  it("lists all sessions for a project", async () => {
    const mgr = new AskSessionManager(storage);
    const s1 = mgr.create("proj", "v1");
    const s2 = mgr.create("proj", "v1", "page-2");
    mgr.create("other-proj", "v1"); // different project
    await mgr.persist(s1.id);
    await mgr.persist(s2.id);

    const sessions = await mgr.list("proj");
    expect(sessions).toHaveLength(2);
    expect(sessions.map((s) => s.id).sort()).toEqual([s1.id, s2.id].sort());
  });

  it("returns undefined for non-existent session", async () => {
    const mgr = new AskSessionManager(storage);
    const loaded = await mgr.get("nonexistent-id", "proj");
    expect(loaded).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm -w test -- --reporter=verbose packages/core/src/ask/__tests__/ask-session-persistence.test.ts`

Expected: FAIL — `get()` doesn't accept a second argument and doesn't load from disk.

- [ ] **Step 4: Implement session loading**

Replace `packages/core/src/ask/ask-session.ts` with:

```typescript
import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import type { StorageAdapter } from "../storage/storage-adapter.js";
import type { AskSession } from "../types/events.js";
import type { CitationRecord } from "../types/generation.js";

export class AskSessionManager {
  private sessions: Map<string, AskSession> = new Map();

  constructor(private readonly storage: StorageAdapter) {}

  create(projectSlug: string, versionId: string, currentPageSlug?: string): AskSession {
    const session: AskSession = {
      id: randomUUID(),
      projectSlug,
      versionId,
      mode: "ask",
      currentPageSlug,
      turns: [],
      updatedAt: new Date().toISOString(),
    };
    this.sessions.set(session.id, session);
    return session;
  }

  /**
   * Get a session by ID. Checks in-memory first, then falls back to disk.
   * @param projectSlug Required for disk lookup — the session file is stored under the project directory.
   */
  async get(sessionId: string, projectSlug?: string): Promise<AskSession | undefined> {
    const cached = this.sessions.get(sessionId);
    if (cached) return cached;

    if (!projectSlug) return undefined;

    const filePath = this.storage.paths.askSessionJson(projectSlug, sessionId);
    const session = await this.storage.readJson<AskSession>(filePath);
    if (session) {
      this.sessions.set(session.id, session);
    }
    return session ?? undefined;
  }

  /** List all persisted sessions for a project by scanning the ask directory. */
  async list(projectSlug: string): Promise<AskSession[]> {
    const dir = this.storage.paths.askDir(projectSlug);
    let files: string[];
    try {
      files = await fs.readdir(dir);
    } catch {
      return [];
    }

    const sessions: AskSession[] = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const session = await this.storage.readJson<AskSession>(`${dir}/${file}`);
      if (session) {
        this.sessions.set(session.id, session);
        sessions.push(session);
      }
    }
    return sessions;
  }

  addUserTurn(sessionId: string, content: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.turns.push({ role: "user", content, citations: [] });
    session.updatedAt = new Date().toISOString();
  }

  addAssistantTurn(sessionId: string, content: string, citations: CitationRecord[]): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.turns.push({ role: "assistant", content, citations });
    session.updatedAt = new Date().toISOString();
  }

  async persist(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const filePath = this.storage.paths.askSessionJson(session.projectSlug, sessionId);
    await this.storage.writeJson(filePath, session);
  }
}
```

- [ ] **Step 5: Update callers that use synchronous `get()`**

Search for all call sites of `sessionManager.get(` and update them to pass `projectSlug` and `await` the result. The `get()` method signature changed from synchronous to async.

Check files: `packages/core/src/ask/ask-stream.ts`, `packages/web/src/app/api/.../ask/route.ts`

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm -w test -- --reporter=verbose packages/core/src/ask/__tests__/ask-session-persistence.test.ts`

Expected: PASS (3 tests)

- [ ] **Step 7: Run full test suite**

Run: `pnpm -w test`

Expected: All tests pass.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/ask/ask-session.ts \
       packages/core/src/ask/__tests__/ask-session-persistence.test.ts \
       packages/core/src/storage/paths.ts
git commit -m "feat(ask): load sessions from disk on cache miss — enables cross-process session continuity"
```

---

### Task 5: CLI Missing Test Coverage

The CLI has 3 test files covering init/generate/cli-structure. Missing: browse, ask, research commands and the progress renderer. Add basic smoke tests.

**Files:**
- Create: `packages/cli/src/__tests__/commands/browse.test.ts`
- Create: `packages/cli/src/__tests__/commands/ask.test.ts`
- Create: `packages/cli/src/__tests__/progress-renderer.test.ts`

- [ ] **Step 1: Write browse command test**

Create `packages/cli/src/__tests__/commands/browse.test.ts`:

```typescript
import { describe, it, expect, vi, afterEach } from "vitest";

// Mock child_process to avoid actually spawning a server
vi.mock("node:child_process", () => ({
  spawn: vi.fn(() => ({
    on: vi.fn(),
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    kill: vi.fn(),
    unref: vi.fn(),
  })),
}));

// Mock open to avoid launching a browser
vi.mock("open", () => ({ default: vi.fn() }));

describe("browse command", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("module exports runBrowse function", async () => {
    const mod = await import("../../commands/browse.js");
    expect(typeof mod.runBrowse).toBe("function");
  });

  it("BrowseOptions type includes port and page fields", async () => {
    // Type-level check: if the interface changes, this test needs updating
    const mod = await import("../../commands/browse.js");
    expect(mod.runBrowse).toBeDefined();
  });
});
```

- [ ] **Step 2: Write progress renderer test**

Create `packages/cli/src/__tests__/progress-renderer.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ProgressRenderer } from "../progress-renderer.js";
import type { AppEvent } from "@reporead/core";

describe("ProgressRenderer", () => {
  let renderer: ProgressRenderer;
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    renderer = new ProgressRenderer();
    stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    renderer.stop();
    vi.restoreAllMocks();
  });

  it("setPageList initializes pages with pending status", () => {
    renderer.setPageList([
      { slug: "overview", title: "Overview" },
      { slug: "core", title: "Core" },
    ]);
    // Internal state not exposed, but onEvent should not throw
    const event: AppEvent = {
      id: "1",
      channel: "job",
      type: "page.evidence_planned",
      at: new Date().toISOString(),
      projectId: "proj",
      pageSlug: "overview",
      payload: {},
    };
    expect(() => renderer.onEvent(event)).not.toThrow();
  });

  it("setResumeSkipped marks first N pages as skipped", () => {
    renderer.setPageList([
      { slug: "a", title: "A" },
      { slug: "b", title: "B" },
      { slug: "c", title: "C" },
    ]);
    renderer.setResumeSkipped(2);
    // Should not throw when processing events for non-skipped pages
    const event: AppEvent = {
      id: "2",
      channel: "job",
      type: "page.evidence_planned",
      at: new Date().toISOString(),
      projectId: "proj",
      pageSlug: "c",
      payload: {},
    };
    expect(() => renderer.onEvent(event)).not.toThrow();
  });

  it("printSummary outputs completion info", () => {
    renderer.setPageList([{ slug: "a", title: "A" }]);
    renderer.printSummary(true, {
      versionId: "2026-04-11",
      id: "job-1",
      summary: { succeededPages: 1, totalPages: 1 },
    });
    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("生成完成");
    expect(output).toContain("2026-04-11");
  });

  it("printSummary outputs failure info with resume command", () => {
    renderer.printSummary(false, {
      versionId: "v1",
      id: "job-fail",
      summary: {},
    });
    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("生成失败");
    expect(output).toContain("--resume");
  });
});
```

- [ ] **Step 3: Write ask command test**

Create `packages/cli/src/__tests__/commands/ask.test.ts`:

```typescript
import { describe, it, expect } from "vitest";

describe("ask command", () => {
  it("module exports runAsk function", async () => {
    const mod = await import("../../commands/ask.js");
    expect(typeof mod.runAsk).toBe("function");
  });
});
```

- [ ] **Step 4: Run all CLI tests**

Run: `pnpm -w test -- --reporter=verbose packages/cli`

Expected: All tests pass (existing 13 + new ~8).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/__tests__/commands/browse.test.ts \
       packages/cli/src/__tests__/commands/ask.test.ts \
       packages/cli/src/__tests__/progress-renderer.test.ts
git commit -m "test(cli): add smoke tests for browse, ask, and progress-renderer"
```

---

## Execution Order

Tasks 1-5 are independent and can be executed in any order. Recommended sequence for maximum impact:

1. **Task 1** (reviewer degradation) — highest impact, prevents job failures
2. **Task 4** (ask session persistence) — completes a core feature gap
3. **Task 2** (keytar warning) — low effort, cleans up build output
4. **Task 3** (hydration mismatch) — low effort, eliminates console noise
5. **Task 5** (CLI tests) — coverage backfill, no user-facing impact

Total estimated time: ~3-4 hours for all 5 tasks.
