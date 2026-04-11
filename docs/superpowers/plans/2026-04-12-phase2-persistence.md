# Phase 2: 中间结果持久化 + 指针传递

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist evidence, outline, and published index to files. Change drafter from receiving full content in-context to receiving file paths and reading via tools.

**Architecture:** Add path helpers to StoragePaths. After evidence/outline complete, write JSON files. Change `MainAuthorContext` to carry file paths instead of content. Update drafter prompt to instruct the model to use `read` tool. Resume skips pages with existing evidence/outline files.

**Tech Stack:** TypeScript strict, Vitest, Node.js 22, Vercel AI SDK

**Depends on:** Phase 1 complete (agents outside loop, resolveApiKeys)

---

## File Structure

### New Files
```
packages/core/src/generation/__tests__/persistence.test.ts
```

### Modified Files
```
packages/core/src/storage/paths.ts                    — add evidenceJson, outlineJson, publishedIndexJson
packages/core/src/generation/generation-pipeline.ts    — write evidence/outline/index files, pass paths to drafter
packages/core/src/types/agent.ts                       — MainAuthorContext adds file path fields
packages/core/src/generation/page-drafter-prompt.ts    — instruct drafter to read files via tools
packages/core/src/generation/page-drafter.ts           — pass file paths in context
```

---

### Task 1: StoragePaths + persistence helpers

**Files:**
- Modify: `packages/core/src/storage/paths.ts`

- [ ] **Step 1: Add path methods**

```typescript
  evidenceJson(slug: string, jobId: string, pageSlug: string): string {
    return path.join(this.jobDir(slug, jobId), "evidence", `${pageSlug}.json`);
  }

  outlineJson(slug: string, jobId: string, pageSlug: string): string {
    return path.join(this.jobDir(slug, jobId), "outline", `${pageSlug}.json`);
  }

  publishedIndexJson(slug: string, jobId: string): string {
    return path.join(this.jobDir(slug, jobId), "published-index.json");
  }
```

- [ ] **Step 2: Commit**

```bash
git add packages/core/src/storage/paths.ts
git commit -m "feat(storage): add evidence, outline, publishedIndex path helpers"
```

---

### Task 2: Pipeline writes evidence + outline to disk

**Files:**
- Modify: `packages/core/src/generation/generation-pipeline.ts`

- [ ] **Step 1: After evidence collection, write to disk**

After `await emitter.pageEvidenceCollected(...)`, add:
```typescript
  await this.storage.writeJson(
    this.storage.paths.evidenceJson(slug, jobId, page.slug),
    { ledger: evidenceResult.ledger, findings: evidenceResult.findings, openQuestions: evidenceResult.openQuestions, failedTaskIds: evidenceResult.failedTaskIds },
  );
```

- [ ] **Step 2: After outline planning, write to disk**

After `outline = await outlinePlanner.plan(...)`, add:
```typescript
  if (outline) {
    await this.storage.writeJson(
      this.storage.paths.outlineJson(slug, jobId, page.slug),
      outline,
    );
  }
```

- [ ] **Step 3: After each page validates, update published index**

After page meta is written, update the cumulative index:
```typescript
  await this.storage.writeJson(
    this.storage.paths.publishedIndexJson(slug, jobId),
    publishedSummaries,
  );
```

- [ ] **Step 4: Resume checks for existing evidence/outline**

In the page loop, after the `skipSlugs` check, add:
```typescript
  // Check if evidence/outline already exist (from a previous partial run)
  if (!evidenceResult) {
    const existingEvidence = await this.storage.readJson(this.storage.paths.evidenceJson(slug, jobId, page.slug));
    if (existingEvidence) {
      evidenceResult = existingEvidence as EvidenceCollectionResult;
      // Skip evidence collection
    }
  }
  if (!outline) {
    const existingOutline = await this.storage.readJson(this.storage.paths.outlineJson(slug, jobId, page.slug));
    if (existingOutline) {
      outline = existingOutline as PageOutline;
    }
  }
```

- [ ] **Step 5: Run tests + commit**

```bash
pnpm -w test
git add packages/core/src/generation/generation-pipeline.ts
git commit -m "feat(pipeline): persist evidence/outline/publishedIndex to disk, skip on resume"
```

---

### Task 3: Drafter receives file paths instead of content

**Files:**
- Modify: `packages/core/src/types/agent.ts`
- Modify: `packages/core/src/generation/generation-pipeline.ts`
- Modify: `packages/core/src/generation/page-drafter-prompt.ts`

- [ ] **Step 1: Add file path fields to MainAuthorContext**

In `types/agent.ts`, add optional fields:
```typescript
export type MainAuthorContext = {
  // ... existing fields kept for backward compat ...
  /** File path to evidence JSON — drafter reads via `read` tool */
  evidence_file?: string;
  /** File path to outline JSON — drafter reads via `read` tool */
  outline_file?: string;
  /** File path to published summaries index */
  published_index_file?: string;
  /** File path to previous draft (for revision) */
  draft_file?: string;
};
```

- [ ] **Step 2: Pipeline passes file paths**

In `generation-pipeline.ts`, when constructing `authorContext`:
```typescript
  const authorContext: MainAuthorContext = {
    project_summary: wiki.summary,
    full_book_summary: wiki.summary,
    current_page_plan: page.rationale,
    published_page_summaries: publishedSummaries,  // keep for backward compat
    evidence_ledger: evidenceResult?.ledger ?? [],  // keep for backward compat
    evidence_file: this.storage.paths.evidenceJson(slug, jobId, page.slug),
    outline_file: outline ? this.storage.paths.outlineJson(slug, jobId, page.slug) : undefined,
    published_index_file: this.storage.paths.publishedIndexJson(slug, jobId),
    ...(outline ? { page_outline: outline } : {}),
    ...(attempt > 0 && draftResult?.markdown && reviewResult?.conclusion
      ? {
          draft_file: this.storage.paths.draftPageMd(slug, jobId, versionId, page.slug),
          revision: {
            attempt,
            previous_draft: draftResult.markdown,
            feedback: reviewResult.conclusion,
          },
        }
      : {}),
  };
```

- [ ] **Step 3: Update drafter prompt to reference files**

In `page-drafter-prompt.ts`, in the user prompt section, add guidance when file paths are present:
```typescript
  // If evidence_file is provided, add instruction
  if (ctx.evidence_file) {
    sections.push(`## Evidence\n\nThe evidence collected for this page is saved at: ${ctx.evidence_file}\nUse the \`read\` tool to examine the evidence when writing each section.`);
  }
  if (ctx.outline_file) {
    sections.push(`## Page Outline\n\nThe page outline is saved at: ${ctx.outline_file}\nUse the \`read\` tool to load the outline before writing.`);
  }
  if (ctx.revision?.attempt && ctx.draft_file) {
    sections.push(`## Revision\n\nYour previous draft is at: ${ctx.draft_file}\nReviewer feedback:\n${JSON.stringify(ctx.revision.feedback.blockers)}\n\nRead the draft, then fix the issues listed above.`);
  }
```

- [ ] **Step 4: Run tests + rebuild + commit**

```bash
pnpm -w test
pnpm --filter @reporead/core build && pnpm --filter @reporead/cli build
git add packages/core/src/types/agent.ts \
       packages/core/src/generation/generation-pipeline.ts \
       packages/core/src/generation/page-drafter-prompt.ts
git commit -m "feat(drafter): receive file paths for evidence/outline/draft — reads via tools instead of in-context"
```

---

### Task 4: Persistence integration test

**Files:**
- Create: `packages/core/src/generation/__tests__/persistence.test.ts`

- [ ] **Step 1: Write test**

Test that after a successful pipeline run, evidence, outline, and published-index files exist on disk with expected structure. Extend the existing golden fixture pattern.

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

// ... (use budget config, 1-page wiki, same mock pattern as pipeline-golden.test.ts)

describe("pipeline persistence", () => {
  // ... setup/teardown ...

  it("writes evidence and outline files during generation", async () => {
    // ... run pipeline ...
    // Check evidence file
    const evidencePath = storage.paths.evidenceJson("proj", job.id, "overview");
    const evidence = await storage.readJson(evidencePath);
    expect(evidence).not.toBeNull();
    expect(evidence).toHaveProperty("ledger");

    // Check outline file
    const outlinePath = storage.paths.outlineJson("proj", job.id, "overview");
    const outline = await storage.readJson(outlinePath);
    expect(outline).not.toBeNull();
    expect(outline).toHaveProperty("sections");

    // Check published index
    const indexPath = storage.paths.publishedIndexJson("proj", job.id);
    const index = await storage.readJson(indexPath);
    expect(index).not.toBeNull();
    expect(Array.isArray(index)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test + commit**

```bash
pnpm -w test
git add packages/core/src/generation/__tests__/persistence.test.ts
git commit -m "test(pipeline): verify evidence/outline/publishedIndex persistence"
```

---

## Verification

- `ls <jobDir>/evidence/` shows one JSON per page
- `ls <jobDir>/outline/` shows one JSON per page
- `<jobDir>/published-index.json` exists and grows with each page
- Resume skips evidence/outline for pages that already have files
- All 318+ tests pass
