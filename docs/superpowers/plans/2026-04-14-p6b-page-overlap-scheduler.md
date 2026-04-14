# P6b: Page Overlap Scheduler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Overlap next page's evidence/outline prefetch with current page's review, reducing total book generation latency without changing publish order.

**Architecture:** A new `PagePrefetcher` writes evidence/outline artifacts to disk during review. The existing `runPageWorkflow` resume logic loads them automatically. A `PrefetchSlot` tracks per-phase metrics, readiness, and status. The pipeline's `for` loop gains prefetch scheduling with explicit await, orphaned cost tracking, and diagnostic fields in throughput.json.

**Tech Stack:** TypeScript strict, Vitest

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/generation/page-prefetcher.ts` | Create | `PrefetchSlot` type, `startPrefetch()` function — runs evidence + outline in background |
| `src/generation/__tests__/page-prefetcher.test.ts` | Create | Unit tests for prefetcher |
| `src/generation/throughput-metrics.ts` | Modify | Add `prefetch?` to `PageThroughputRecord`, `orphanedPrefetch` + `prefetchHitRate` to `ThroughputReport` |
| `src/generation/generation-pipeline.ts` | Modify | Add prefetch scheduling to for loop, pass `prefetchSlot` to `runPageWorkflow`, orphaned cost handling |

---

### Task 1: Throughput Metrics — Prefetch Fields

**Files:**
- Modify: `packages/core/src/generation/throughput-metrics.ts`
- Test: `packages/core/src/generation/__tests__/throughput-prefetch-metrics.test.ts`

Add prefetch diagnostic fields to the throughput types and ensure `ThroughputReportBuilder.finish()` does NOT double-count `prefetch.phases` in totals.

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/core/src/generation/__tests__/throughput-prefetch-metrics.test.ts
import { describe, it, expect } from "vitest";
import {
  ThroughputReportBuilder,
  zeroPhaseMetric,
  zeroUsage,
  type PageThroughputRecord,
  type PhaseMetric,
} from "../throughput-metrics.js";

function makePageRecord(overrides: Partial<PageThroughputRecord> = {}): PageThroughputRecord {
  const zeroPhase: PhaseMetric = zeroPhaseMetric();
  return {
    pageSlug: "test-page",
    lane: "standard",
    totalLatencyMs: 1000,
    revisionAttempts: 0,
    escalatedToDeepLane: false,
    phases: {
      evidence: { ...zeroPhase, llmCalls: 2, usage: { inputTokens: 500, outputTokens: 100, reasoningTokens: 0, cachedTokens: 0 } },
      outline: { ...zeroPhase, llmCalls: 1, usage: { inputTokens: 200, outputTokens: 50, reasoningTokens: 0, cachedTokens: 0 } },
      draft: { ...zeroPhase, llmCalls: 1, usage: { inputTokens: 1000, outputTokens: 500, reasoningTokens: 0, cachedTokens: 0 } },
      review: zeroPhase,
      validate: zeroPhase,
    },
    usage: { inputTokens: 1700, outputTokens: 650, reasoningTokens: 0, cachedTokens: 0, requests: 4 },
    ...overrides,
  };
}

describe("ThroughputReport prefetch fields", () => {
  it("accepts prefetch field on PageThroughputRecord", () => {
    const record = makePageRecord({
      prefetch: {
        hit: true,
        waitMs: 0,
        phases: {
          evidence: { llmCalls: 2, durationMs: 5000, usage: { inputTokens: 500, outputTokens: 100, reasoningTokens: 0, cachedTokens: 0 } },
          outline: { llmCalls: 1, durationMs: 1000, usage: { inputTokens: 200, outputTokens: 50, reasoningTokens: 0, cachedTokens: 0 } },
        },
      },
    });
    expect(record.prefetch!.hit).toBe(true);
    expect(record.prefetch!.phases.evidence!.llmCalls).toBe(2);
  });

  it("does NOT double-count prefetch.phases in totals", () => {
    const builder = new ThroughputReportBuilder();
    builder.setCatalog(zeroPhaseMetric());

    // Page has evidence cost in phases AND identical cost mirrored in prefetch
    const record = makePageRecord({
      prefetch: {
        hit: true,
        waitMs: 0,
        phases: {
          evidence: { llmCalls: 2, durationMs: 5000, usage: { inputTokens: 500, outputTokens: 100, reasoningTokens: 0, cachedTokens: 0 } },
        },
      },
    });
    builder.addPage(record);

    const report = builder.finish({ totalLatencyMs: 10000 });
    // Totals should only count phases (4 calls), NOT phases + prefetch.phases
    expect(report.totals.llmCalls).toBe(4);
    expect(report.totals.usage.inputTokens).toBe(1700);
  });

  it("computes prefetchHitRate correctly", () => {
    const builder = new ThroughputReportBuilder();
    builder.setCatalog(zeroPhaseMetric());

    // Page 1: prefetched and hit
    builder.addPage(makePageRecord({
      pageSlug: "p1",
      prefetch: { hit: true, waitMs: 0, phases: {} },
    }));
    // Page 2: prefetched but missed (prefetch failed, re-ran from scratch)
    builder.addPage(makePageRecord({
      pageSlug: "p2",
      prefetch: { hit: false, waitMs: 100, phases: {} },
    }));
    // Page 3: no prefetch at all (first page)
    builder.addPage(makePageRecord({ pageSlug: "p3" }));

    const report = builder.finish({ totalLatencyMs: 10000 });
    // 1 hit out of 2 prefetched pages (p3 has no prefetch field → not counted)
    expect(report.prefetchHitRate).toBe(0.5);
  });

  it("includes orphanedPrefetch in report", () => {
    const builder = new ThroughputReportBuilder();
    builder.setCatalog(zeroPhaseMetric());
    builder.addPage(makePageRecord());
    builder.setOrphanedPrefetch({
      phases: {
        evidence: { llmCalls: 1, durationMs: 3000, usage: { inputTokens: 300, outputTokens: 80, reasoningTokens: 0, cachedTokens: 0 } },
      },
    });

    const report = builder.finish({ totalLatencyMs: 10000 });
    expect(report.orphanedPrefetch).toBeDefined();
    expect(report.orphanedPrefetch!.phases.evidence!.llmCalls).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && npx vitest run packages/core/src/generation/__tests__/throughput-prefetch-metrics.test.ts`
Expected: FAIL — `prefetch` field doesn't exist, `prefetchHitRate`/`orphanedPrefetch` not in report, `setOrphanedPrefetch` not a function.

- [ ] **Step 3: Update throughput-metrics.ts types**

Add to `PageThroughputRecord`:

```typescript
/** Prefetch diagnostic — only present when this page was a prefetch target.
 *  phases is a diagnostic mirror; it MUST NOT be included in totals aggregation. */
prefetch?: {
  hit: boolean;
  waitMs: number;
  phases: {
    evidence?: PhaseMetric;
    outline?: PhaseMetric;
  };
};
```

Add to `ThroughputReport`:

```typescript
prefetchHitRate: number;
orphanedPrefetch?: {
  phases: {
    evidence?: PhaseMetric;
    outline?: PhaseMetric;
  };
};
```

- [ ] **Step 4: Update ThroughputReportBuilder**

Add `orphanedPrefetch` storage and `setOrphanedPrefetch()` method.

Update `finish()` to compute `prefetchHitRate`:

```typescript
const prefetchedPages = this.pageRecords.filter(p => p.prefetch != null);
const prefetchHits = prefetchedPages.filter(p => p.prefetch!.hit).length;
const prefetchHitRate = prefetchedPages.length > 0 ? prefetchHits / prefetchedPages.length : 0;
```

Include `orphanedPrefetch` and `prefetchHitRate` in the returned report. Do NOT iterate `page.prefetch.phases` in the totals loop.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && npx vitest run packages/core/src/generation/__tests__/throughput-prefetch-metrics.test.ts`
Expected: ALL PASS (4 tests)

- [ ] **Step 6: Run full test suite**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && npx vitest run`
Expected: ALL PASS

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/generation/throughput-metrics.ts packages/core/src/generation/__tests__/throughput-prefetch-metrics.test.ts
git commit -m "feat(metrics): add prefetch diagnostic fields to throughput report"
```

---

### Task 2: PagePrefetcher — Core Implementation

**Files:**
- Create: `packages/core/src/generation/page-prefetcher.ts`
- Create: `packages/core/src/generation/__tests__/page-prefetcher.test.ts`

The prefetcher runs evidence + outline for a page and writes artifacts to disk. It does NOT emit lifecycle events, does NOT change job state. It tracks per-phase metrics and readiness.

- [ ] **Step 1: Write the tests**

```typescript
// packages/core/src/generation/__tests__/page-prefetcher.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { startPrefetch, type PrefetchSlot } from "../page-prefetcher.js";

// Mock EvidenceCoordinator
const mockCollect = vi.fn();
vi.mock("../evidence-coordinator.js", () => ({
  EvidenceCoordinator: vi.fn().mockImplementation(() => ({
    collect: mockCollect,
  })),
}));

// Mock OutlinePlanner
const mockPlanWithMetrics = vi.fn();
vi.mock("../outline-planner.js", () => ({
  OutlinePlanner: vi.fn().mockImplementation(() => ({
    planWithMetrics: mockPlanWithMetrics,
  })),
}));

// Mock ArtifactStore
const mockSaveEvidence = vi.fn().mockResolvedValue(undefined);
const mockSaveOutline = vi.fn().mockResolvedValue(undefined);
const mockArtifactStore = {
  saveEvidence: mockSaveEvidence,
  saveOutline: mockSaveOutline,
};

const basePage = {
  slug: "test-page",
  title: "Test Page",
  rationale: "Test rationale",
  covered_files: ["src/a.ts", "src/b.ts"],
};

const baseContext = {
  wiki: { summary: "Test project", reading_order: [basePage] },
  pageIndex: 0,
  slug: "test-project",
  jobId: "job-1",
  language: "zh",
  publishedSummaries: [{ slug: "prev", title: "Prev", summary: "Previous page" }],
  artifactStore: mockArtifactStore as any,
  workerModel: {} as any,
  drafterModel: {} as any,
  outlineModel: {} as any,
  workerProviderOpts: {},
  outlineProviderOpts: {},
  repoRoot: "/tmp/repo",
  allowBash: true,
};

const evidenceResult = {
  ledger: [{ id: "e1", kind: "file", target: "src/a.ts", note: "found" }],
  findings: ["finding 1"],
  openQuestions: [],
  plan: { tasks: [{ id: "t1" }] },
  failedTaskIds: [],
  usedFallback: false,
  metrics: { llmCalls: 2, usage: { inputTokens: 500, outputTokens: 100, reasoningTokens: 0, cachedTokens: 0 } },
};

const outlineResult = {
  outline: { sections: [{ heading: "Section 1", key_points: ["point"], cite_from: [] }] },
  usedFallback: false,
  metrics: { llmCalls: 1, usage: { inputTokens: 200, outputTokens: 50, reasoningTokens: 0, cachedTokens: 0 } },
};

describe("PagePrefetcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("prefetches evidence + outline, writes artifacts, reports metrics", async () => {
    mockCollect.mockResolvedValue(evidenceResult);
    mockPlanWithMetrics.mockResolvedValue(outlineResult);

    const slot = startPrefetch(basePage, baseContext);
    expect(slot.status).toBe("running");
    expect(slot.pageSlug).toBe("test-page");

    await slot.promise;

    expect(slot.status).toBe("done");
    expect(slot.artifactsReady.evidence).toBe(true);
    expect(slot.artifactsReady.outline).toBe(true);
    expect(slot.phases.evidence!.llmCalls).toBe(2);
    expect(slot.phases.outline!.llmCalls).toBe(1);
    expect(slot.error).toBeNull();
    expect(mockSaveEvidence).toHaveBeenCalledOnce();
    expect(mockSaveOutline).toHaveBeenCalledOnce();
  });

  it("evidence succeeds but outline fails — partial readiness", async () => {
    mockCollect.mockResolvedValue(evidenceResult);
    mockPlanWithMetrics.mockRejectedValue(new Error("outline LLM timeout"));

    const slot = startPrefetch(basePage, baseContext);
    await slot.promise;

    expect(slot.status).toBe("done");
    expect(slot.artifactsReady.evidence).toBe(true);
    expect(slot.artifactsReady.outline).toBe(false);
    expect(slot.phases.evidence!.llmCalls).toBe(2);
    expect(slot.phases.outline).toBeUndefined();
  });

  it("total failure — status=failed, no throw", async () => {
    mockCollect.mockRejectedValue(new Error("API error"));

    const slot = startPrefetch(basePage, baseContext);
    await slot.promise; // must NOT throw

    expect(slot.status).toBe("failed");
    expect(slot.artifactsReady.evidence).toBe(false);
    expect(slot.artifactsReady.outline).toBe(false);
    expect(slot.error).toContain("API error");
  });

  it("uses forkWorkers=1 for lightweight profile", async () => {
    mockCollect.mockResolvedValue(evidenceResult);
    mockPlanWithMetrics.mockResolvedValue(outlineResult);

    startPrefetch(basePage, baseContext);

    // Verify EvidenceCoordinator was constructed with concurrency=1
    const { EvidenceCoordinator } = await import("../evidence-coordinator.js");
    const ctorCall = vi.mocked(EvidenceCoordinator).mock.calls[0][0];
    expect(ctorCall.concurrency).toBe(1);
  });

  it("uses snapshot of publishedSummaries (not shared reference)", async () => {
    mockCollect.mockResolvedValue(evidenceResult);
    mockPlanWithMetrics.mockResolvedValue(outlineResult);

    const mutableSummaries = [{ slug: "prev", title: "Prev", summary: "Previous" }];
    const ctx = { ...baseContext, publishedSummaries: mutableSummaries };

    const slot = startPrefetch(basePage, ctx);

    // Mutate the original array after prefetch started
    mutableSummaries.push({ slug: "new", title: "New", summary: "Added after" });

    await slot.promise;

    // The collect call should have received the snapshot (length 1), not the mutated array (length 2)
    expect(mockCollect.mock.calls[0][0].publishedSummaries).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && npx vitest run packages/core/src/generation/__tests__/page-prefetcher.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement page-prefetcher.ts**

```typescript
// packages/core/src/generation/page-prefetcher.ts
/**
 * Background page prefetcher — runs evidence + outline for the NEXT page
 * while the current page is in review.
 *
 * HARD CONSTRAINTS:
 * - ✅ Writes artifacts (artifactStore.saveEvidence / saveOutline)
 * - ✅ Writes debug log (REPOREAD_DEBUG path)
 * - ❌ Does NOT emit lifecycle events (pageEvidencePlanned, pageEvidenceCollected)
 * - ❌ Does NOT call jobManager.transition / updatePage
 * - ❌ Does NOT change job state
 * - ❌ Does NOT trigger any page lifecycle event
 *
 * Prefetch is invisible to UI and events.ndjson. The formal workflow
 * emits events when it loads the prefetched artifacts.
 */

import type { LanguageModel } from "ai";
import type { WikiJson } from "../types/generation.js";
import type { PageOutline } from "../types/agent.js";
import type { UsageInput } from "../utils/usage-tracker.js";
import type { PhaseMetric } from "./throughput-metrics.js";
import type { ProviderCallOptions } from "../runtime/turn-types.js";
import type { ArtifactStore } from "../artifacts/artifact-store.js";
import type { StepInfo } from "../agent/agent-loop.js";
import { EvidenceCoordinator, type EvidenceCollectionResult } from "./evidence-coordinator.js";
import { OutlinePlanner } from "./outline-planner.js";

export type PrefetchSlot = {
  pageSlug: string;
  promise: Promise<void>;
  status: "running" | "done" | "failed";
  phases: {
    evidence?: PhaseMetric;
    outline?: PhaseMetric;
  };
  artifactsReady: {
    evidence: boolean;
    outline: boolean;
  };
  error: string | null;
};

export type PrefetchContext = {
  wiki: WikiJson;
  pageIndex: number;
  slug: string;
  jobId: string;
  language: string;
  /** Must be a SNAPSHOT (shallow copy), not a shared reference. */
  publishedSummaries: Array<{ slug: string; title: string; summary: string }>;
  artifactStore: ArtifactStore;
  workerModel: LanguageModel;
  drafterModel: LanguageModel;
  outlineModel: LanguageModel;
  workerProviderOpts: ProviderCallOptions;
  outlineProviderOpts: ProviderCallOptions;
  repoRoot: string;
  allowBash: boolean;
  onWorkerStep?: (step: StepInfo) => void;
  onOutlineStep?: (step: StepInfo) => void;
};

type PageEntry = WikiJson["reading_order"][number];

export function startPrefetch(
  page: PageEntry,
  ctx: PrefetchContext,
): PrefetchSlot {
  const slot: PrefetchSlot = {
    pageSlug: page.slug,
    promise: null as unknown as Promise<void>,
    status: "running",
    phases: {},
    artifactsReady: { evidence: false, outline: false },
    error: null,
  };

  const pageRef = { projectSlug: ctx.slug, jobId: ctx.jobId, pageSlug: page.slug };

  slot.promise = runPrefetch(slot, page, pageRef, ctx).catch((err) => {
    slot.status = "failed";
    slot.error = (err as Error).message;
  });

  return slot;
}

async function runPrefetch(
  slot: PrefetchSlot,
  page: PageEntry,
  pageRef: { projectSlug: string; jobId: string; pageSlug: string },
  ctx: PrefetchContext,
): Promise<void> {
  // Evidence collection with lightweight profile: forkWorkers=1, concurrency=1
  const coordinator = new EvidenceCoordinator({
    plannerModel: ctx.drafterModel,
    workerModel: ctx.workerModel,
    repoRoot: ctx.repoRoot,
    concurrency: 1,
    workerMaxSteps: 6,
    allowBash: ctx.allowBash,
    providerCallOptions: ctx.workerProviderOpts,
    onWorkerStep: ctx.onWorkerStep,
  });

  let evidenceResult: EvidenceCollectionResult | null = null;

  // Phase 1: Evidence
  const evidenceStart = Date.now();
  try {
    evidenceResult = await coordinator.collect({
      pageTitle: page.title,
      pageRationale: page.rationale,
      pageOrder: ctx.pageIndex + 1,
      coveredFiles: page.covered_files,
      publishedSummaries: ctx.publishedSummaries,
      taskCount: 1,
      language: ctx.language,
      workerContext: [
        `Project: ${ctx.wiki.summary}`,
        `Page plan: ${page.rationale}`,
      ].join("\n"),
    });

    await ctx.artifactStore.saveEvidence(pageRef, {
      ledger: evidenceResult.ledger,
      findings: evidenceResult.findings,
      openQuestions: evidenceResult.openQuestions,
      failedTaskIds: evidenceResult.failedTaskIds,
    });

    slot.artifactsReady.evidence = true;
    slot.phases.evidence = {
      llmCalls: evidenceResult.metrics.llmCalls,
      durationMs: Date.now() - evidenceStart,
      usage: { ...evidenceResult.metrics.usage },
    };
  } catch {
    // Evidence failed — leave artifactsReady.evidence = false
    // Formal workflow will re-run evidence from scratch
  }

  // Phase 2: Outline (only if evidence succeeded)
  if (evidenceResult) {
    const outlineStart = Date.now();
    try {
      const outlinePlanner = new OutlinePlanner({
        model: ctx.outlineModel,
        providerCallOptions: ctx.outlineProviderOpts,
        onStep: ctx.onOutlineStep,
      });

      const outlineResult = await outlinePlanner.planWithMetrics({
        pageTitle: page.title,
        pageRationale: page.rationale,
        coveredFiles: page.covered_files,
        language: ctx.language,
        ledger: evidenceResult.ledger,
        findings: evidenceResult.findings,
      });

      if (outlineResult.outline) {
        await ctx.artifactStore.saveOutline(pageRef, outlineResult.outline);
        slot.artifactsReady.outline = true;
        slot.phases.outline = {
          llmCalls: outlineResult.metrics.llmCalls,
          durationMs: Date.now() - outlineStart,
          usage: { ...outlineResult.metrics.usage },
        };
      }
    } catch {
      // Outline failed — leave artifactsReady.outline = false
    }
  }

  slot.status = "done";
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && npx vitest run packages/core/src/generation/__tests__/page-prefetcher.test.ts`
Expected: ALL PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/generation/page-prefetcher.ts packages/core/src/generation/__tests__/page-prefetcher.test.ts
git commit -m "feat(generation): add PagePrefetcher — background evidence/outline for next page"
```

---

### Task 3: Pipeline Integration — Prefetch Scheduling

**Files:**
- Modify: `packages/core/src/generation/generation-pipeline.ts`

This is the integration task. Wire the prefetcher into the pipeline's `for` loop and `runPageWorkflow`.

- [ ] **Step 1: Add imports**

At the top of `generation-pipeline.ts`, add:

```typescript
import { startPrefetch, type PrefetchSlot } from "./page-prefetcher.js";
```

- [ ] **Step 2: Add prefetch state to the page loop**

Before the `for` loop (~line 245), add:

```typescript
let activePrefetch: PrefetchSlot | null = null;
const prefetchedSlugs = new Set<string>();
```

- [ ] **Step 3: Add prefetch await + slot handoff at page start**

Inside the `for` loop, after `skipSlugs` check and before `runPageWorkflow` call:

```typescript
// Await any active prefetch for this page (correctness: non-atomic writes)
let prefetchSlot: PrefetchSlot | null = null;
let prefetchWaitMs = 0;
if (activePrefetch?.pageSlug === page.slug) {
  const waitStart = Date.now();
  await activePrefetch.promise.catch(() => {});
  prefetchWaitMs = Date.now() - waitStart;
  prefetchSlot = activePrefetch;
  activePrefetch = null;
}
```

- [ ] **Step 4: Pass prefetchSlot to runPageWorkflow**

Add `prefetchSlot` and `prefetchWaitMs` to the `runPageWorkflow` call:

```typescript
const pageResult = await this.runPageWorkflow({
  ...existingFields,
  prefetchSlot,
  prefetchWaitMs,
});
```

- [ ] **Step 5: Add prefetch scheduling inside runPageWorkflow**

In the review section of `runPageWorkflow`, just before the `ladder.verify()` call, add the prefetch trigger. This goes inside the `while(true)` revision loop, guarded by `prefetchedSlugs`:

```typescript
// Start prefetching next page's evidence/outline during review
const nextIdx = i + 1;
if (nextIdx < wiki.reading_order.length) {
  const nextPage = wiki.reading_order[nextIdx];
  if (!prefetchedSlugs.has(nextPage.slug) && !skipSlugs.has(nextPage.slug)) {
    prefetchedSlugs.add(nextPage.slug);
    activePrefetch = startPrefetch(nextPage, {
      wiki,
      pageIndex: nextIdx,
      slug,
      jobId,
      language: this.config.language,
      publishedSummaries: [...publishedSummaries], // SNAPSHOT
      artifactStore: this.artifactStore,
      workerModel: this.workerModel,
      drafterModel: this.drafterModel,
      outlineModel: this.outlineModel,
      workerProviderOpts,
      outlineProviderOpts,
      repoRoot: this.repoRoot,
      allowBash,
      onWorkerStep: (step) => this.usageTracker.add("worker", ...),
      onOutlineStep: (step) => this.usageTracker.add("outline", ...),
    });
  }
}
```

Note: `prefetchedSlugs`, `activePrefetch`, `skipSlugs`, `workerProviderOpts`, and `outlineProviderOpts` need to be passed into `runPageWorkflow` context, or accessed via closure. The simplest approach: add them to the `ctx` parameter.

- [ ] **Step 6: Modify resume logic to use prefetchSlot metrics**

In `runPageWorkflow`, where the resume logic loads evidence from disk (~line 496-513), update it to inherit prefetch metrics:

```typescript
if (attempt === 0 && !evidenceResult) {
  const existing = await this.artifactStore.loadEvidence<any>(pageRef);
  if (existing && existing.ledger) {
    evidenceResult = existing as EvidenceCollectionResult;
    const existingOutline = await this.artifactStore.loadOutline<PageOutline>(pageRef);
    if (existingOutline) outline = existingOutline;
    await emitter.pageEvidencePlanned(page.slug, evidenceResult.plan?.tasks?.length ?? 0, false);
    await emitter.pageEvidenceCollected(page.slug, evidenceResult.ledger.length, 0, 0);

    // Disk is truth. Slot provides metrics context.
    if (prefetchSlot?.artifactsReady.evidence && prefetchSlot.phases.evidence) {
      // Prefetched in this job — use real LLM cost
      evidenceMetric = prefetchSlot.phases.evidence;
    } else {
      // Loaded from previous job — true reuse
      evidenceMetric = { llmCalls: 0, durationMs: 0, usage: { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cachedTokens: 0 }, reused: true };
    }

    if (existingOutline) {
      if (prefetchSlot?.artifactsReady.outline && prefetchSlot.phases.outline) {
        outlineMetric = prefetchSlot.phases.outline;
      } else {
        outlineMetric = { llmCalls: 0, durationMs: 0, usage: { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cachedTokens: 0 }, reused: true };
      }
    }
  }
}
```

- [ ] **Step 7: Record prefetch diagnostics in page throughput record**

In the page metrics construction (~line 966), add the `prefetch` field:

```typescript
const pageMetrics: PageThroughputRecord = {
  ...existingFields,
  prefetch: prefetchSlot ? {
    hit: prefetchSlot.artifactsReady.evidence || prefetchSlot.artifactsReady.outline,
    waitMs: prefetchWaitMs,
    phases: { ...prefetchSlot.phases },
  } : undefined,
};
```

Also update `buildPartialPageMetrics` to accept and pass `prefetch?`.

- [ ] **Step 8: Add orphaned prefetch handling on job failure**

In the pipeline's failure paths (both the explicit `!pageResult.success` check and the outer `catch`), add:

```typescript
if (activePrefetch) {
  await activePrefetch.promise.catch(() => {});
  if (activePrefetch.phases.evidence || activePrefetch.phases.outline) {
    throughput.setOrphanedPrefetch({ phases: { ...activePrefetch.phases } });
  }
}
```

Also add this to the job success cleanup path (after the `for` loop ends, for the last page's unused prefetch).

- [ ] **Step 9: Run full test suite**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && npx vitest run`
Expected: ALL PASS

- [ ] **Step 10: Run typecheck**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && npx tsc -p packages/core/tsconfig.json --noEmit`
Expected: No errors

- [ ] **Step 11: Commit**

```bash
git add packages/core/src/generation/generation-pipeline.ts
git commit -m "feat(pipeline): integrate page overlap prefetch — evidence/outline overlap with review"
```

---

### Task 4: Pipeline Integration Tests

**Files:**
- Create: `packages/core/src/generation/__tests__/page-overlap-integration.test.ts`

Integration tests verifying the full prefetch flow with mocked LLM calls but real artifact store logic.

- [ ] **Step 1: Write integration tests**

```typescript
// packages/core/src/generation/__tests__/page-overlap-integration.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// This file tests the interaction between prefetch scheduling and
// the pipeline's page loop. Key scenarios:
//
// 1. 2-page happy path: page[1] evidence/outline show prefetch metrics
// 2. Prefetch failure: page[1] runs normally from scratch
// 3. Job failure after prefetch: orphanedPrefetchCost recorded
// 4. Resume with skipSlugs: skipped pages not prefetched
// 5. prefetch.phases NOT double-counted in totals
```

(Full test code follows the pattern established in the existing `generation-pipeline.test.ts` — mock the `ai` module, create a minimal wiki with 2-3 pages, verify throughput records.)

Key assertions per test:

**Test 1 (happy path):**
- `page[1].prefetch.hit === true`
- `page[1].prefetch.waitMs >= 0`
- `page[1].phases.evidence.llmCalls > 0` (inherits prefetch cost)
- `report.prefetchHitRate > 0`

**Test 2 (prefetch fails):**
- `page[1].prefetch.hit === false`
- `page[1].phases.evidence` has normal (non-prefetched) cost
- Pipeline still succeeds

**Test 3 (job failure with orphan):**
- `report.orphanedPrefetch.phases.evidence` has cost
- `report.totals` does NOT include orphaned cost

**Test 4 (resume):**
- Skipped pages have no `prefetch` field
- prefetchHitRate only counts non-skipped pages

- [ ] **Step 2: Run tests**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && npx vitest run packages/core/src/generation/__tests__/page-overlap-integration.test.ts`
Expected: ALL PASS

- [ ] **Step 3: Run full test suite**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && npx vitest run`
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/generation/__tests__/page-overlap-integration.test.ts
git commit -m "test(pipeline): add page overlap prefetch integration tests"
```

---

## Self-Review Checklist

**1. Spec coverage:**
- [x] PrefetchSlot with per-phase metrics + readiness (Spec §2) → Task 2
- [x] PageThroughputRecord.prefetch diagnostic field (Spec §2) → Task 1
- [x] ThroughputReport.orphanedPrefetch + prefetchHitRate (Spec §2) → Task 1
- [x] startPrefetch snapshots publishedSummaries (Spec §3.1) → Task 2 test 5
- [x] Each next page prefetched at most once (Spec §3.2) → Task 3 step 5
- [x] Await before page starts (Spec §3.3) → Task 3 step 3
- [x] Lightweight profile forkWorkers=1 (Spec §3.4) → Task 2 code + test 4
- [x] prefetch.phases not in totals (Spec §3.5) → Task 1 test
- [x] orphanedPrefetch per-phase (Spec §3.6) → Task 1
- [x] No lifecycle events from prefetcher (Spec §3.7) → Task 2 file-level constraint
- [x] skipSlugs guard (Spec §3.8) → Task 3 step 5
- [x] Disk is truth, slot is diagnostic (Spec §3.9) → Task 3 step 6

**2. Placeholder scan:** No TBDs. Task 4 test code is described by assertions rather than full code (this is the one exception — the test file follows established patterns from generation-pipeline.test.ts and the full mock setup is already documented there).

**3. Type consistency:** `PrefetchSlot`, `PrefetchContext`, `startPrefetch` — consistent across Task 2 and Task 3. `PhaseMetric` reused from existing types. `ThroughputReportBuilder.setOrphanedPrefetch` defined in Task 1, called in Task 3.
