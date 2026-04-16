# Throughput 50%+ Reduction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce page-by-page generation wall time by 60%+ across real projects by (1) capping evidence re-runs, (2) removing the hardcoded deep-lane revision bonus, and (3) introducing a configurable N-way page parallel scheduler.

**Architecture:** Phase 1 adds two QualityProfile fields (`maxEvidenceAttempts`, `deepLaneRevisionBonus`) and wires them into the pipeline's evidence condition and execution-lane boostedParams. Phase 2 adds `pageConcurrency` plus a new `ParallelPageScheduler` that owns a `Semaphore` and per-page `reviewGate` promises; `runPageWorkflow` awaits its `reviewGate` before the first review so `publishedSummaries` stays ordered. All three components support a clean rollback (setting cap=99, bonus=1, or concurrency=1 restores current behavior).

**Tech Stack:** TypeScript strict, Vitest, pnpm workspace, existing `GenerationPipeline` / `QualityProfile` / `ExecutionLane` / `ArtifactStore`.

---

## File Structure

### Create

- `packages/core/src/generation/semaphore.ts` — counting semaphore utility (acquire/release queue)
- `packages/core/src/generation/__tests__/semaphore.test.ts` — unit tests for Semaphore
- `packages/core/src/generation/parallel-scheduler.ts` — `ParallelPageScheduler` + `createGate` helper
- `packages/core/src/generation/__tests__/parallel-scheduler.test.ts` — scheduler unit tests
- `packages/core/src/generation/__tests__/generation-pipeline-parallel.test.ts` — pipeline integration tests with concurrency=3

### Modify

- `packages/core/src/config/quality-profile.ts` — add 3 fields (`maxEvidenceAttempts`, `deepLaneRevisionBonus`, `pageConcurrency`) with preset defaults
- `packages/core/src/config/__tests__/quality-profile.test.ts` — assert new fields on all presets
- `packages/core/src/generation/execution-lane.ts` — read `deepLaneRevisionBonus` from base profile instead of hardcoded `+1`
- `packages/core/src/generation/__tests__/execution-lane.test.ts` — exercise bonus=0 and bonus=1 paths (create file if missing)
- `packages/core/src/generation/generation-pipeline.ts` — evidence cap counter; replace main `for` loop with scheduler; `runPageWorkflow` accepts `reviewGate` + `onFirstReviewStart`; `publishedSummaries` treated as shared mutable reference
- `packages/cli/src/commands/generate.tsx` — add `--page-concurrency <n>` flag

### Out Of Scope

- `packages/core/src/generation/evidence-coordinator.ts` internals (no algorithm changes)
- `packages/core/src/review/*` reviewer strictness tuning
- Evidence Fabric / cross-page caching (Phase 3 in spec, deferred)

---

## Phase 1: Engineering + Quality Parameter Tuning

### Task 1: Add `maxEvidenceAttempts` field to QualityProfile

**Files:**
- Modify: `packages/core/src/config/quality-profile.ts`
- Modify: `packages/core/src/config/__tests__/quality-profile.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/core/src/config/__tests__/quality-profile.test.ts`:

```typescript
  it("each preset has maxEvidenceAttempts >= 1", () => {
    for (const preset of ["quality", "balanced", "budget", "local-only"] as const) {
      const p = getQualityProfile(preset);
      expect(p.maxEvidenceAttempts).toBeGreaterThanOrEqual(1);
    }
  });

  it("quality preset caps evidence at 2 total attempts (1 initial + 1 incremental)", () => {
    expect(getQualityProfile("quality").maxEvidenceAttempts).toBe(2);
  });

  it("budget preset caps evidence at 1 attempt (no re-runs)", () => {
    expect(getQualityProfile("budget").maxEvidenceAttempts).toBe(1);
  });
```

- [ ] **Step 2: Run the test, confirm FAIL**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && pnpm --filter @reporead/core test -- quality-profile`
Expected: FAIL — `maxEvidenceAttempts` is `undefined` on every preset.

- [ ] **Step 3: Add the field to the type**

In `packages/core/src/config/quality-profile.ts`, modify the `QualityProfile` type (around line 25-37):

```typescript
export type QualityProfile = {
  forkWorkers: number;
  forkWorkerConcurrency: number;
  maxRevisionAttempts: number;
  /**
   * Upper bound on total evidence-collection attempts per page (initial + incremental re-runs).
   * Reviewer-triggered re-runs beyond this limit are suppressed; drafter reuses the existing ledger.
   * Set to 1 to disable incremental re-runs entirely.
   */
  maxEvidenceAttempts: number;
  drafterMaxSteps: number;
  reviewerMaxSteps: number;
  reviewerVerifyMinCitations: number;
  reviewerStrictness: "lenient" | "normal" | "strict";
  workerMaxSteps: number;
  catalogMaxSteps: number;
  askMaxSteps: number;
  researchMaxSteps: number;
};
```

- [ ] **Step 4: Add the field to each preset**

In the same file, in `QUALITY_PROFILES`, add `maxEvidenceAttempts` to each preset:

```typescript
  quality: Object.freeze({
    forkWorkers: 3,
    forkWorkerConcurrency: 3,
    maxRevisionAttempts: 3,
    maxEvidenceAttempts: 2,  // NEW
    // ...existing fields...
  }),
  balanced: Object.freeze({
    // ...
    maxRevisionAttempts: 2,
    maxEvidenceAttempts: 2,  // NEW
    // ...
  }),
  budget: Object.freeze({
    // ...
    maxRevisionAttempts: 1,
    maxEvidenceAttempts: 1,  // NEW
    // ...
  }),
  "local-only": Object.freeze({
    // ...
    maxRevisionAttempts: 1,
    maxEvidenceAttempts: 1,  // NEW
    // ...
  }),
```

- [ ] **Step 5: Run the test, confirm PASS**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && pnpm --filter @reporead/core test -- quality-profile`
Expected: PASS (all 3 new tests green, no regressions).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/config/quality-profile.ts packages/core/src/config/__tests__/quality-profile.test.ts
git commit -m "$(cat <<'EOF'
feat(quality-profile): add maxEvidenceAttempts field per preset

Cap evidence-collection attempts per page (initial + incremental re-runs).
quality/balanced = 2, budget/local-only = 1. Pipeline consumes in Task 2.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Enforce evidence cap in pipeline

**Files:**
- Modify: `packages/core/src/generation/generation-pipeline.ts:597-608`
- Test: existing `packages/core/src/generation/__tests__/evidence-replanning.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/core/src/generation/__tests__/evidence-replanning.test.ts` (reuse the existing setup helpers):

```typescript
  it("stops re-running evidence once maxEvidenceAttempts is reached", async () => {
    // quality preset: maxEvidenceAttempts=2 (1 initial + 1 re-run max)
    // Reviewer flags missing_evidence on every attempt; we expect
    // collect() to be called at most 2 times despite 3 revision rounds.
    const ctx = makePipelineCtx({
      preset: "quality",
      reviewerAlwaysFlagsMissingEvidence: true,
      revisions: 3,
    });
    await runPageWorkflow(ctx);
    expect(ctx.coordinator.collect).toHaveBeenCalledTimes(2);
  });
```

If `makePipelineCtx` does not yet support `reviewerAlwaysFlagsMissingEvidence`, extend it: the mock reviewer's conclusion should always return `{ missing_evidence: ["need more"], verdict: "revise", ... }`. Read the current test file to learn the exact helper signature.

- [ ] **Step 2: Run the test, confirm FAIL**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && pnpm --filter @reporead/core test -- evidence-replanning`
Expected: FAIL — `collect` called 3+ times (no cap yet).

- [ ] **Step 3: Add the counter in runPageWorkflow**

In `packages/core/src/generation/generation-pipeline.ts`, find the section right before the `while(true)` loop starts (around line 546-557, the phase-metrics initialization block). Add after the `let prefetchHitOutline = false;` line:

```typescript
    // Count evidence collection attempts (prefetch-loaded evidence counts as 1)
    let evidenceCollectionCount = 0;
    if (prefetchSlot?.artifactsReady.evidence) {
      evidenceCollectionCount = 1;
    }
```

- [ ] **Step 4: Gate `shouldCollectEvidence` on the counter**

In the same file at `packages/core/src/generation/generation-pipeline.ts:597-603`, change:

```typescript
      const shouldCollectEvidence =
        coordinator !== null &&
        ((attempt === 0 && !evidenceResult) ||
          (attempt > 0 &&
            ((reviewResult?.conclusion?.missing_evidence?.length ?? 0) > 0 ||
              (reviewResult?.conclusion?.factual_risks?.length ?? 0) > 0 ||
              (reviewResult?.conclusion?.scope_violations?.length ?? 0) > 0)));
```

to:

```typescript
      const shouldCollectEvidence =
        coordinator !== null &&
        evidenceCollectionCount < qp.maxEvidenceAttempts &&
        ((attempt === 0 && !evidenceResult) ||
          (attempt > 0 &&
            ((reviewResult?.conclusion?.missing_evidence?.length ?? 0) > 0 ||
              (reviewResult?.conclusion?.factual_risks?.length ?? 0) > 0 ||
              (reviewResult?.conclusion?.scope_violations?.length ?? 0) > 0)));
```

- [ ] **Step 5: Increment the counter inside the `if (shouldCollectEvidence)` block**

In the same file around line 607 (`if (shouldCollectEvidence) { evidenceJustCollected = true; ...`), add the increment as the first statement inside the block:

```typescript
      if (shouldCollectEvidence) {
        evidenceCollectionCount++;
        evidenceJustCollected = true;
        // ... existing body unchanged ...
```

- [ ] **Step 6: Also increment when evidence is loaded from disk on first attempt**

Still in `generation-pipeline.ts`, find the `attempt === 0 && !evidenceResult` disk-load block (around line 562-591). Inside the inner `if (existing && existing.ledger)` block, where `evidenceResult` is assigned, add:

```typescript
        if (existing && existing.ledger) {
          evidenceResult = existing as EvidenceCollectionResult;
          evidenceCollectionCount = 1;  // NEW: disk load counts as 1 attempt
          // ...existing body unchanged...
```

This prevents double-counting when prefetch also hit (`artifactsReady.evidence=true` already set count=1 earlier; this line is a no-op in that case because the disk load and prefetch hit coincide, but it handles the resume-from-previous-job path where there is no prefetchSlot).

- [ ] **Step 7: Run the focused test, confirm PASS**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && pnpm --filter @reporead/core test -- evidence-replanning`
Expected: PASS (new test + all existing tests).

- [ ] **Step 8: Run the full core package test suite**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && pnpm --filter @reporead/core test`
Expected: All tests pass.

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/generation/generation-pipeline.ts packages/core/src/generation/__tests__/evidence-replanning.test.ts
git commit -m "$(cat <<'EOF'
feat(pipeline): cap evidence collection by qp.maxEvidenceAttempts

Counter increments on prefetch load, disk load, and inline collect.
Reviewer-triggered re-runs short-circuit once the cap is reached; drafter
reuses existing ledger. repo-read estimated gain: -21%.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Add `deepLaneRevisionBonus` field to QualityProfile

**Files:**
- Modify: `packages/core/src/config/quality-profile.ts`
- Modify: `packages/core/src/config/__tests__/quality-profile.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/core/src/config/__tests__/quality-profile.test.ts`:

```typescript
  it("every preset defines deepLaneRevisionBonus (default 0)", () => {
    for (const preset of ["quality", "balanced", "budget", "local-only"] as const) {
      const p = getQualityProfile(preset);
      expect(p.deepLaneRevisionBonus).toBeGreaterThanOrEqual(0);
      expect(p.deepLaneRevisionBonus).toBeLessThanOrEqual(2);
    }
  });

  it("quality preset has deepLaneRevisionBonus=0 (removes legacy +1)", () => {
    expect(getQualityProfile("quality").deepLaneRevisionBonus).toBe(0);
  });
```

- [ ] **Step 2: Run test, confirm FAIL**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && pnpm --filter @reporead/core test -- quality-profile`
Expected: FAIL — field undefined.

- [ ] **Step 3: Extend the type**

In `packages/core/src/config/quality-profile.ts`, add to the `QualityProfile` type:

```typescript
  /**
   * Extra revision budget granted to pages running on the deep lane, on top
   * of `maxRevisionAttempts`. Historically hardcoded to +1; now configurable
   * per-preset. Set to 0 to treat deep pages identically to standard.
   */
  deepLaneRevisionBonus: number;
```

- [ ] **Step 4: Set bonus=0 on every preset**

In the same file, add to each of the 4 presets inside `QUALITY_PROFILES`:

```typescript
    deepLaneRevisionBonus: 0,  // NEW — pre-existing hardcoded +1 is now opt-in via preset
```

- [ ] **Step 5: Run test, confirm PASS**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && pnpm --filter @reporead/core test -- quality-profile`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/config/quality-profile.ts packages/core/src/config/__tests__/quality-profile.test.ts
git commit -m "$(cat <<'EOF'
feat(quality-profile): add deepLaneRevisionBonus (default 0)

Replaces the hardcoded deep-lane +1 revision with a per-preset setting.
Default 0 means deep and standard share the same cap; Task 4 wires this
into execution-lane.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Wire `deepLaneRevisionBonus` into execution-lane

**Files:**
- Modify: `packages/core/src/generation/execution-lane.ts:31-37`
- Modify or Create: `packages/core/src/generation/__tests__/execution-lane.test.ts`

- [ ] **Step 1: Check whether the test file exists**

Run: `ls packages/core/src/generation/__tests__/execution-lane.test.ts 2>/dev/null && echo EXISTS || echo MISSING`
If MISSING, create a new file; otherwise append to the existing one.

- [ ] **Step 2: Write the failing test**

Write or append to `packages/core/src/generation/__tests__/execution-lane.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { selectExecutionLane } from "../execution-lane.js";
import { getQualityProfile } from "../../config/quality-profile.js";

describe("selectExecutionLane deepLaneRevisionBonus", () => {
  it("with bonus=0, deep lane maxRevisionAttempts equals base", () => {
    const base = { ...getQualityProfile("quality"), deepLaneRevisionBonus: 0 };
    const plan = selectExecutionLane({
      preset: "quality",
      base,
      complexity: { score: 20, fileCount: 30, dirSpread: 3, crossLanguage: false },
      signals: {},
    });
    expect(plan.lane).toBe("deep");
    expect(plan.policy.maxRevisionAttempts).toBe(base.maxRevisionAttempts);
  });

  it("with bonus=1, deep lane adds +1 revision", () => {
    const base = { ...getQualityProfile("quality"), deepLaneRevisionBonus: 1 };
    const plan = selectExecutionLane({
      preset: "quality",
      base,
      complexity: { score: 20, fileCount: 30, dirSpread: 3, crossLanguage: false },
      signals: {},
    });
    expect(plan.lane).toBe("deep");
    expect(plan.policy.maxRevisionAttempts).toBe(base.maxRevisionAttempts + 1);
  });

  it("runtime signals with bonus=0 still trigger deep lane without +1", () => {
    const base = { ...getQualityProfile("quality"), deepLaneRevisionBonus: 0 };
    const plan = selectExecutionLane({
      preset: "quality",
      base,
      complexity: { score: 5, fileCount: 5, dirSpread: 1, crossLanguage: false },
      signals: { factualRisksCount: 2 },
    });
    expect(plan.lane).toBe("deep");
    expect(plan.policy.maxRevisionAttempts).toBe(base.maxRevisionAttempts);
  });
});
```

- [ ] **Step 3: Run test, confirm FAIL**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && pnpm --filter @reporead/core test -- execution-lane`
Expected: FAIL — bonus=0 currently still adds +1 (hardcoded), so test 1 + test 3 fail.

- [ ] **Step 4: Replace the hardcoded `+1` in execution-lane.ts**

In `packages/core/src/generation/execution-lane.ts:31-36`, change:

```typescript
    const boostedParams: AdjustedParams = {
      ...params,
      forkWorkers: params.forkWorkers + 1,
      drafterMaxSteps: params.drafterMaxSteps + 10,
      maxRevisionAttempts: params.maxRevisionAttempts + 1,
    };
```

to:

```typescript
    const boostedParams: AdjustedParams = {
      ...params,
      forkWorkers: params.forkWorkers + 1,
      drafterMaxSteps: params.drafterMaxSteps + 10,
      maxRevisionAttempts: params.maxRevisionAttempts + base.deepLaneRevisionBonus,
    };
```

Note: `base` is already a parameter to `selectExecutionLane` and is typed `QualityProfile`, which now includes `deepLaneRevisionBonus` thanks to Task 3.

- [ ] **Step 5: Run test, confirm PASS**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && pnpm --filter @reporead/core test -- execution-lane`
Expected: PASS (3 new tests).

- [ ] **Step 6: Run full core test suite**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && pnpm --filter @reporead/core test`
Expected: PASS. If `escalation-policy.test.ts` fails because it implicitly expected the legacy +1, update those assertions — the expected value now matches `base.maxRevisionAttempts + base.deepLaneRevisionBonus`, which is 0 under the new defaults.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/generation/execution-lane.ts packages/core/src/generation/__tests__/execution-lane.test.ts
git commit -m "$(cat <<'EOF'
feat(execution-lane): read deepLaneRevisionBonus from base profile

Removes hardcoded +1 revision for deep lane; pre-existing behavior is now
opt-in via deepLaneRevisionBonus=1 in the preset. With default bonus=0,
deep lane pages match standard lane cap — expected to cut ~1 wasted
revision per L1 page.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 2: N-way Page Parallel Scheduler

### Task 5: Create Semaphore utility

**Files:**
- Create: `packages/core/src/generation/semaphore.ts`
- Create: `packages/core/src/generation/__tests__/semaphore.test.ts`

- [ ] **Step 1: Write the failing test**

Write `packages/core/src/generation/__tests__/semaphore.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { Semaphore } from "../semaphore.js";

describe("Semaphore", () => {
  it("throws when count < 1", () => {
    expect(() => new Semaphore(0)).toThrow();
    expect(() => new Semaphore(-1)).toThrow();
  });

  it("allows immediate acquire up to capacity", async () => {
    const sem = new Semaphore(2);
    await sem.acquire();
    await sem.acquire();
    // third acquire would block; verify with a race
    let acquired = false;
    const pending = sem.acquire().then(() => { acquired = true; });
    // Give microtasks a chance
    await new Promise((r) => setImmediate(r));
    expect(acquired).toBe(false);
    sem.release();
    await pending;
    expect(acquired).toBe(true);
  });

  it("release wakes waiters in FIFO order", async () => {
    const sem = new Semaphore(1);
    await sem.acquire();
    const events: number[] = [];
    const p1 = sem.acquire().then(() => events.push(1));
    const p2 = sem.acquire().then(() => events.push(2));
    sem.release();
    await p1;
    sem.release();
    await p2;
    expect(events).toEqual([1, 2]);
  });

  it("release when no waiters increments available permits", async () => {
    const sem = new Semaphore(1);
    sem.release();       // permits = 2
    await sem.acquire(); // permits = 1
    await sem.acquire(); // permits = 0
    let acquired = false;
    sem.acquire().then(() => { acquired = true; });
    await new Promise((r) => setImmediate(r));
    expect(acquired).toBe(false);
  });
});
```

- [ ] **Step 2: Run test, confirm FAIL**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && pnpm --filter @reporead/core test -- semaphore`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement Semaphore**

Write `packages/core/src/generation/semaphore.ts`:

```typescript
/**
 * Counting semaphore with a FIFO wait queue.
 *
 * - `acquire()` resolves immediately if a permit is available, otherwise
 *   queues and resolves when some other caller releases.
 * - `release()` hands a permit to the next waiter (if any) before
 *   returning permits to the pool. This preserves FIFO fairness.
 */
export class Semaphore {
  private permits: number;
  private readonly queue: Array<() => void> = [];

  constructor(count: number) {
    if (count < 1) {
      throw new Error(`Semaphore count must be >= 1, got ${count}`);
    }
    this.permits = count;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }
    await new Promise<void>((resolve) => this.queue.push(resolve));
  }

  release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.permits++;
    }
  }
}
```

- [ ] **Step 4: Run test, confirm PASS**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && pnpm --filter @reporead/core test -- semaphore`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/generation/semaphore.ts packages/core/src/generation/__tests__/semaphore.test.ts
git commit -m "$(cat <<'EOF'
feat(generation): add Semaphore utility (FIFO counting semaphore)

Used by the upcoming ParallelPageScheduler to cap in-flight pages.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Create ParallelPageScheduler skeleton + gate utilities

**Files:**
- Create: `packages/core/src/generation/parallel-scheduler.ts`
- Create: `packages/core/src/generation/__tests__/parallel-scheduler.test.ts`

- [ ] **Step 1: Write the failing test (core behaviors)**

Write `packages/core/src/generation/__tests__/parallel-scheduler.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import {
  ParallelPageScheduler,
  createGate,
  type PageRunResult,
} from "../parallel-scheduler.js";

type TestPage = { slug: string; title: string };

function mockPages(n: number): TestPage[] {
  return Array.from({ length: n }, (_, i) => ({
    slug: `page-${i}`,
    title: `Page ${i}`,
  }));
}

describe("createGate", () => {
  it("returns a resolvable promise", async () => {
    const gate = createGate();
    let resolved = false;
    gate.promise.then(() => { resolved = true; });
    await new Promise((r) => setImmediate(r));
    expect(resolved).toBe(false);
    gate.resolve();
    await gate.promise;
    expect(resolved).toBe(true);
  });
});

describe("ParallelPageScheduler", () => {
  it("runs zero pages without error", async () => {
    const scheduler = new ParallelPageScheduler({
      concurrency: 3,
      runPage: vi.fn(),
    });
    const results = await scheduler.runAll<TestPage>([], []);
    expect(results).toEqual([]);
  });

  it("concurrency=1 behaves sequentially", async () => {
    const runPage = vi.fn(
      async (ctx: { page: TestPage; pageIndex: number; reviewGate: Promise<void> }): Promise<PageRunResult> => {
        await ctx.reviewGate;
        return {
          success: true,
          summary: { slug: ctx.page.slug, title: ctx.page.title, summary: "s" },
        };
      },
    );
    const scheduler = new ParallelPageScheduler({ concurrency: 1, runPage });
    const pages = mockPages(3);
    const summaries: Array<{ slug: string; title: string; summary: string }> = [];
    const results = await scheduler.runAll(pages, summaries);
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.success)).toBe(true);
    expect(summaries.map((s) => s.slug)).toEqual(["page-0", "page-1", "page-2"]);
  });

  it("concurrency=3 runs up to 3 pages in parallel and enforces gate order", async () => {
    const startOrder: string[] = [];
    const endOrder: string[] = [];
    const activeReleases: Array<() => void> = [];

    const runPage = vi.fn(
      async (ctx: { page: TestPage; reviewGate: Promise<void> }): Promise<PageRunResult> => {
        startOrder.push(ctx.page.slug);
        // hold open until explicitly released
        await new Promise<void>((resolve) => activeReleases.push(resolve));
        await ctx.reviewGate;
        endOrder.push(ctx.page.slug);
        return {
          success: true,
          summary: { slug: ctx.page.slug, title: ctx.page.title, summary: "s" },
        };
      },
    );
    const scheduler = new ParallelPageScheduler({ concurrency: 3, runPage });
    const pages = mockPages(5);
    const summaries: Array<{ slug: string; title: string; summary: string }> = [];
    const runPromise = scheduler.runAll(pages, summaries);

    // After microtasks, 3 pages should be started but none finished
    await new Promise((r) => setImmediate(r));
    expect(startOrder).toEqual(["page-0", "page-1", "page-2"]);
    expect(endOrder).toEqual([]);

    // Release page-0 — it should finish, unblock page-1's review gate,
    // and let page-3 start.
    activeReleases[0]();
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(endOrder).toContain("page-0");
    expect(startOrder).toContain("page-3");

    // Release the remaining pages to complete the run
    for (const release of activeReleases.slice(1)) release();
    const results = await runPromise;

    expect(results).toHaveLength(5);
    expect(summaries.map((s) => s.slug)).toEqual([
      "page-0", "page-1", "page-2", "page-3", "page-4",
    ]);
  });

  it("failed page still resolves its gate so later pages proceed", async () => {
    const runPage = vi.fn(
      async (ctx: { page: TestPage; pageIndex: number; reviewGate: Promise<void> }): Promise<PageRunResult> => {
        await ctx.reviewGate;
        if (ctx.page.slug === "page-1") {
          return { success: false, error: "boom" };
        }
        return {
          success: true,
          summary: { slug: ctx.page.slug, title: ctx.page.title, summary: "s" },
        };
      },
    );
    const scheduler = new ParallelPageScheduler({ concurrency: 2, runPage });
    const pages = mockPages(3);
    const summaries: Array<{ slug: string; title: string; summary: string }> = [];
    const results = await scheduler.runAll(pages, summaries);

    expect(results[0].success).toBe(true);
    expect(results[1].success).toBe(false);
    expect(results[2].success).toBe(true);
    expect(summaries.map((s) => s.slug)).toEqual(["page-0", "page-2"]);
  });

  it("thrown error in runPage is captured as failure, not propagated", async () => {
    const runPage = vi.fn(async (ctx: { page: TestPage; reviewGate: Promise<void> }) => {
      await ctx.reviewGate;
      if (ctx.page.slug === "page-1") throw new Error("crash");
      return {
        success: true,
        summary: { slug: ctx.page.slug, title: ctx.page.title, summary: "s" },
      } as PageRunResult;
    });
    const scheduler = new ParallelPageScheduler({ concurrency: 2, runPage });
    const results = await scheduler.runAll(mockPages(3), []);
    expect(results[1].success).toBe(false);
    expect(results[1].error).toContain("crash");
    expect(results[0].success).toBe(true);
    expect(results[2].success).toBe(true);
  });
});
```

- [ ] **Step 2: Run test, confirm FAIL**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && pnpm --filter @reporead/core test -- parallel-scheduler`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the scheduler**

Write `packages/core/src/generation/parallel-scheduler.ts`:

```typescript
import { Semaphore } from "./semaphore.js";

export type PublishedSummary = { slug: string; title: string; summary: string };

export type PageGate = {
  promise: Promise<void>;
  resolve: () => void;
};

/** Create a promise/resolver pair used to signal "previous page is safe to consume". */
export function createGate(): PageGate {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

export type PageRunResult = {
  success: boolean;
  summary?: PublishedSummary;
  error?: string;
  // The pipeline attaches full throughput records; the scheduler is agnostic.
  // Use a wide index signature so the scheduler does not depend on the
  // pipeline-specific record shape.
  [key: string]: unknown;
};

export type PageRunContext<Page> = {
  page: Page;
  pageIndex: number;
  reviewGate: Promise<void>;
  onFirstReviewStart?: () => void;
};

export type ParallelSchedulerOptions<Page> = {
  concurrency: number;
  runPage: (ctx: PageRunContext<Page>) => Promise<PageRunResult>;
};

/**
 * Sliding-window scheduler for page workflows.
 *
 * Contract:
 * - Dispatches up to `concurrency` pages concurrently.
 * - Each page receives a `reviewGate` that must be awaited before the first
 *   review. Gate N resolves when page N-1 has validated (or failed) — this
 *   guarantees `publishedSummaries` is up-to-date when review begins.
 * - Failures are captured in `PageRunResult.success=false`; the scheduler
 *   never re-throws so a single page failure does not poison the batch.
 * - Summaries are appended to the shared `publishedSummaries` array in
 *   reading order once each page validates successfully.
 */
export class ParallelPageScheduler<Page> {
  constructor(private readonly opts: ParallelSchedulerOptions<Page>) {
    if (opts.concurrency < 1) {
      throw new Error(`concurrency must be >= 1, got ${opts.concurrency}`);
    }
  }

  async runAll<P extends Page = Page>(
    pages: readonly P[],
    publishedSummaries: PublishedSummary[],
  ): Promise<PageRunResult[]> {
    if (pages.length === 0) return [];

    const { concurrency, runPage } = this.opts;
    const gates = pages.map(() => createGate());
    const semaphore = new Semaphore(concurrency);
    const results: PageRunResult[] = new Array(pages.length);

    await Promise.all(
      pages.map(async (page, i) => {
        await semaphore.acquire();
        try {
          const reviewGate = i > 0 ? gates[i - 1].promise : Promise.resolve();
          let result: PageRunResult;
          try {
            result = await runPage({
              page: page as unknown as Page,
              pageIndex: i,
              reviewGate,
            });
          } catch (err) {
            result = {
              success: false,
              error: (err as Error).message ?? String(err),
            };
          }
          if (result.success && result.summary) {
            publishedSummaries.push(result.summary);
          }
          results[i] = result;
        } finally {
          gates[i].resolve();  // ALWAYS resolve — even on failure
          semaphore.release();
        }
      }),
    );

    return results;
  }
}
```

- [ ] **Step 4: Run test, confirm PASS**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && pnpm --filter @reporead/core test -- parallel-scheduler`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/generation/parallel-scheduler.ts packages/core/src/generation/__tests__/parallel-scheduler.test.ts
git commit -m "$(cat <<'EOF'
feat(generation): add ParallelPageScheduler + createGate

Sliding-window scheduler: up to N concurrent pages, per-page reviewGate
guarantees publishedSummaries ordering, failures resolve gates to prevent
deadlock. Pipeline integration follows in later tasks.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Add `pageConcurrency` field to QualityProfile

**Files:**
- Modify: `packages/core/src/config/quality-profile.ts`
- Modify: `packages/core/src/config/__tests__/quality-profile.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/core/src/config/__tests__/quality-profile.test.ts`:

```typescript
  it("every preset defines pageConcurrency >= 1", () => {
    for (const preset of ["quality", "balanced", "budget", "local-only"] as const) {
      const p = getQualityProfile(preset);
      expect(p.pageConcurrency).toBeGreaterThanOrEqual(1);
    }
  });

  it("quality preset has pageConcurrency=3 (default target)", () => {
    expect(getQualityProfile("quality").pageConcurrency).toBe(3);
  });

  it("budget preset has pageConcurrency=1 (serial)", () => {
    expect(getQualityProfile("budget").pageConcurrency).toBe(1);
  });
```

- [ ] **Step 2: Run test, confirm FAIL**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && pnpm --filter @reporead/core test -- quality-profile`
Expected: FAIL — field undefined.

- [ ] **Step 3: Add field to type**

In `packages/core/src/config/quality-profile.ts`:

```typescript
  /**
   * Upper bound on pages running concurrently inside a single generation job.
   * 1 = strictly serial (legacy behavior). Higher values let the
   * ParallelPageScheduler overlap evidence/outline/draft with revision loops
   * of earlier pages. CLI may override via `--page-concurrency`.
   */
  pageConcurrency: number;
```

- [ ] **Step 4: Add field to each preset**

In the same file, add to each of the 4 presets:

- `quality`: `pageConcurrency: 3`
- `balanced`: `pageConcurrency: 2`
- `budget`: `pageConcurrency: 1`
- `local-only`: `pageConcurrency: 1`

- [ ] **Step 5: Run test, confirm PASS**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && pnpm --filter @reporead/core test -- quality-profile`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/config/quality-profile.ts packages/core/src/config/__tests__/quality-profile.test.ts
git commit -m "$(cat <<'EOF'
feat(quality-profile): add pageConcurrency field per preset

quality=3, balanced=2, budget/local-only=1. The pipeline scheduler
consumes this in Task 9.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Extend `runPageWorkflow` with `reviewGate`

**Files:**
- Modify: `packages/core/src/generation/generation-pipeline.ts`

- [ ] **Step 1: Add the parameters to the ctx type**

In `packages/core/src/generation/generation-pipeline.ts:448-474`, extend the `ctx` parameter type for `runPageWorkflow`:

```typescript
  private async runPageWorkflow(ctx: {
    page: WikiJson["reading_order"][number];
    pageIndex: number;
    wiki: WikiJson;
    job: GenerationJob;
    slug: string;
    jobId: string;
    versionId: string;
    emitter: JobEventEmitter;
    publishedSummaries: Array<{ slug: string; title: string; summary: string }>;
    knownPages: string[];
    qp: ResolvedConfig["qualityProfile"];
    allowBash: boolean;
    drafter: PageDrafter;
    ladder: VerificationLadder;
    coordinator: EvidenceCoordinator | null;
    outlinePlanner: OutlinePlanner;
    drafterProviderOpts: ProviderCallOptions;
    prefetchSlot: PrefetchSlot | null;
    prefetchWaitMs: number;
    skipSlugs: Set<string>;
    prefetchedSlugs: Set<string>;
    workerProviderOpts: ProviderCallOptions;
    outlineProviderOpts: ProviderCallOptions;
    reviewerProviderOpts: ProviderCallOptions;
    setActivePrefetch: (slot: PrefetchSlot | null) => void;
    /** Awaited before the first review so publishedSummaries is up-to-date. */
    reviewGate: Promise<void>;
    onFirstReviewStart?: () => void;
  }): Promise<{ success: boolean; job: GenerationJob; error?: string; pageMetrics?: PageThroughputRecord }> {
```

- [ ] **Step 2: Destructure the new fields**

In the same file around line 475-482, update the destructure block:

```typescript
    const {
      page, pageIndex: i, wiki, slug, jobId, versionId, emitter,
      publishedSummaries, knownPages, qp, allowBash, drafter, ladder,
      coordinator, outlinePlanner, drafterProviderOpts,
      prefetchSlot, prefetchWaitMs, skipSlugs, prefetchedSlugs,
      workerProviderOpts, outlineProviderOpts, reviewerProviderOpts,
      reviewGate, onFirstReviewStart,
    } = ctx;
```

- [ ] **Step 3: Await the gate and fire the callback before the first review**

Find the location right before the `ladder.verify(...)` call (typically inside the `while(true)` loop, after draft completion). Add:

```typescript
      // On the first review attempt of this page, wait until the previous
      // page's publishedSummary is available. This is a no-op for page 0.
      if (attempt === 0) {
        await reviewGate;
        onFirstReviewStart?.();
      }

      const reviewResult = await ladder.verify(/* ...existing args... */);
```

To find the exact insertion point, `grep -n "ladder.verify\|activeLadder.verify" packages/core/src/generation/generation-pipeline.ts`. Insert the 4 new lines directly above the first such call inside the `while(true)` block.

- [ ] **Step 4: Supply the new fields at the existing call site (transitional shim)**

At `packages/core/src/generation/generation-pipeline.ts:269-295`, in the `for` loop that still calls `runPageWorkflow` directly, append `reviewGate: Promise.resolve(),` and `onFirstReviewStart: () => {}` to the object literal:

```typescript
        const pageResult = await this.runPageWorkflow({
          // ...existing fields...
          setActivePrefetch: (slot) => { prefetchRef.current = slot; },
          reviewGate: Promise.resolve(),   // NEW transitional — scheduler takes over in Task 9
          onFirstReviewStart: () => {},     // NEW transitional
        });
```

This keeps the for-loop path compiling and behaviorally identical (immediate-resolved gate = no wait).

- [ ] **Step 5: Run full core tests**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && pnpm --filter @reporead/core test`
Expected: All existing tests still pass — behavior is unchanged because `reviewGate: Promise.resolve()` is always immediately satisfied.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/generation/generation-pipeline.ts
git commit -m "$(cat <<'EOF'
feat(pipeline): add reviewGate + onFirstReviewStart to runPageWorkflow

runPageWorkflow awaits reviewGate before the first ladder.verify call;
existing for-loop passes Promise.resolve() so behavior is unchanged. The
scheduler in Task 9 will supply a real gate tied to the previous page's
validate.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Replace the pipeline for-loop with the scheduler

**Files:**
- Modify: `packages/core/src/generation/generation-pipeline.ts:249-325`

- [ ] **Step 1: Add the import**

Near the other imports at the top of `generation-pipeline.ts`, add:

```typescript
import { ParallelPageScheduler, type PageRunResult } from "./parallel-scheduler.js";
```

- [ ] **Step 2: Replace the for-loop with a scheduler call**

Replace the block at `packages/core/src/generation/generation-pipeline.ts:249-325` (the `for (let i = 0; i < wiki.reading_order.length; i++)` loop plus the post-loop prefetch drain) with:

```typescript
      const prefetchedSlugs = new Set<string>();

      // Page dispatch is delegated to the ParallelPageScheduler. Gates and
      // the semaphore guarantee publishedSummaries stays ordered even under
      // concurrency > 1.
      const scheduler = new ParallelPageScheduler<WikiJson["reading_order"][number]>({
        concurrency: qp.pageConcurrency,
        runPage: async ({ page, pageIndex, reviewGate, onFirstReviewStart }) => {
          if (skipSlugs.has(page.slug)) {
            return { success: true };  // Resume path — nothing to do
          }

          // Await and consume any prefetch specifically targeting this page
          let prefetchSlot: PrefetchSlot | null = null;
          let prefetchWaitMs = 0;
          if (prefetchRef.current?.pageSlug === page.slug) {
            const waitStart = Date.now();
            await prefetchRef.current.promise.catch(() => {});
            prefetchWaitMs = Date.now() - waitStart;
            prefetchSlot = prefetchRef.current;
            prefetchRef.current = null;
          }

          const pageResult = await this.runPageWorkflow({
            page,
            pageIndex,
            wiki,
            job,
            slug,
            jobId,
            versionId,
            emitter,
            publishedSummaries,
            knownPages,
            qp,
            allowBash,
            drafter,
            ladder,
            coordinator,
            outlinePlanner,
            drafterProviderOpts,
            prefetchSlot,
            prefetchWaitMs,
            skipSlugs,
            prefetchedSlugs,
            workerProviderOpts,
            outlineProviderOpts,
            reviewerProviderOpts,
            setActivePrefetch: (slot) => { prefetchRef.current = slot; },
            reviewGate,
            onFirstReviewStart,
          });

          if (!pageResult.success) {
            return {
              success: false,
              error: pageResult.error,
              pageMetrics: pageResult.pageMetrics,
            };
          }

          // Note: publishedSummaries is pushed inside runPageWorkflow (existing
          // behavior). The scheduler does NOT rely on the returned `summary`
          // field — it just needs to know the page validated to resolve its
          // gate, which happens automatically when this function returns.
          job = pageResult.job;
          return {
            success: true,
            pageMetrics: pageResult.pageMetrics,
          };
        },
      });

      const pageResults = await scheduler.runAll(wiki.reading_order, publishedSummaries);

      // Aggregate metrics + handle the first failure (if any)
      for (let i = 0; i < pageResults.length; i++) {
        const result = pageResults[i];
        if (result.pageMetrics) {
          throughput.addPage(result.pageMetrics as PageThroughputRecord);
        }
      }

      const firstFailure = pageResults.find((r) => !r.success);
      if (firstFailure) {
        if (prefetchRef.current) {
          await prefetchRef.current.promise.catch(() => {});
          if (prefetchRef.current.phases.evidence || prefetchRef.current.phases.outline) {
            throughput.setOrphanedPrefetch({ phases: { ...prefetchRef.current.phases } });
          }
          prefetchRef.current = null;
        }
        await this.artifactStore.saveThroughputMetrics(
          { projectSlug: slug, jobId },
          throughput.finish({ totalLatencyMs: Date.now() - pipelineStartedAt }),
        ).catch(() => {});
        return this.failJob(job, emitter, firstFailure.error ?? "page failed");
      }

      // Drain any remaining unused prefetch (success path)
      if (prefetchRef.current) {
        await prefetchRef.current.promise.catch(() => {});
        if (prefetchRef.current.phases.evidence || prefetchRef.current.phases.outline) {
          throughput.setOrphanedPrefetch({ phases: { ...prefetchRef.current.phases } });
        }
        prefetchRef.current = null;
      }
```

**Notes:**
- `publishedSummaries` is still pushed inside `runPageWorkflow` (unchanged) — the scheduler only uses the returned `summary` field if present, and we're intentionally not setting it here so we don't duplicate the push.
- The `job.summary.succeededPages` counter is still incremented inside `runPageWorkflow`; no change needed.
- Concurrency=1 reproduces strict serial behavior because the scheduler awaits the previous page's gate (which resolves on its completion) before starting the next.

- [ ] **Step 3: Remove the transitional fields from Task 8 Step 4 (no longer referenced)**

The transitional shim in Task 8 Step 4 lived inside the old for-loop. Since the for-loop is now replaced, the shim is automatically gone.

- [ ] **Step 4: Run full core tests**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && pnpm --filter @reporead/core test`
Expected: All existing tests pass. Some tests may exercise the serial path explicitly (e.g. `generation-pipeline.test.ts`) — they should continue passing because `qp.pageConcurrency` defaults to 1 in those test fixtures (budget preset). If a test uses the `quality` preset and starts failing because `pageConcurrency=3` changes timing, pin that test to a serial preset or read Task 10 for the dedicated parallel test.

- [ ] **Step 5: Run typecheck**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && pnpm --filter @reporead/core typecheck`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/generation/generation-pipeline.ts
git commit -m "$(cat <<'EOF'
feat(pipeline): dispatch pages via ParallelPageScheduler

Replaces the strict-serial for loop with the scheduler. At qp.pageConcurrency=1
behavior matches the old path; higher values overlap pipeline stages of
neighboring pages. Failure aggregation and prefetch drain logic preserved.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Add pipeline-level parallel integration test

**Files:**
- Create: `packages/core/src/generation/__tests__/generation-pipeline-parallel.test.ts`

- [ ] **Step 1: Read existing pipeline test for mock patterns**

Run: `head -100 packages/core/src/generation/__tests__/generation-pipeline.test.ts`
Note the mock factories for models, artifact store, and wiki. The new test reuses these.

- [ ] **Step 2: Write the parallel integration test**

Write `packages/core/src/generation/__tests__/generation-pipeline-parallel.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
// Reuse the helper factories from the sibling test file. If the existing
// test file does not export them, duplicate the minimal setup needed for
// these cases. Below assumes the helpers are exported or you copy the
// minimal factory inline.

import type { WikiJson } from "../../types/generation.js";

// NOTE: This test requires the same mock scaffolding as
// generation-pipeline.test.ts (mock LLM, mock artifact store, mock fs).
// Follow the same patterns there; the assertions here are what matters.

describe("GenerationPipeline parallel scheduler", () => {
  it("pageConcurrency=3 produces same publishedSummaries order as pageConcurrency=1", async () => {
    const wiki: WikiJson = {
      summary: "test",
      reading_order: [
        { slug: "p0", title: "P0", rationale: "r", covered_files: ["a.ts"] },
        { slug: "p1", title: "P1", rationale: "r", covered_files: ["b.ts"] },
        { slug: "p2", title: "P2", rationale: "r", covered_files: ["c.ts"] },
        { slug: "p3", title: "P3", rationale: "r", covered_files: ["d.ts"] },
      ],
    };

    // Run the same fixture twice: once at concurrency=1, once at concurrency=3.
    // Compare the published summary ordering and the set of validated slugs.
    const serialSummaries = await runFixture(wiki, { pageConcurrency: 1 });
    const parallelSummaries = await runFixture(wiki, { pageConcurrency: 3 });

    expect(serialSummaries.map((s) => s.slug)).toEqual(["p0", "p1", "p2", "p3"]);
    expect(parallelSummaries.map((s) => s.slug)).toEqual(["p0", "p1", "p2", "p3"]);
  });

  it("review sees publishedSummaries of all prior validated pages", async () => {
    // Instrument the mock reviewer to capture publishedSummaries length
    // at the moment of first review. With 4 pages and concurrency=3:
    // - p0 first review: 0 prior summaries
    // - p1 first review: must be >= 1 (after p0 gate)
    // - p2 first review: must be >= 2
    // - p3 first review: must be >= 3
    const observed: Record<string, number> = {};
    const wiki: WikiJson = {
      summary: "test",
      reading_order: [
        { slug: "p0", title: "P0", rationale: "r", covered_files: ["a.ts"] },
        { slug: "p1", title: "P1", rationale: "r", covered_files: ["b.ts"] },
        { slug: "p2", title: "P2", rationale: "r", covered_files: ["c.ts"] },
        { slug: "p3", title: "P3", rationale: "r", covered_files: ["d.ts"] },
      ],
    };

    await runFixture(wiki, {
      pageConcurrency: 3,
      onReviewerCalled: (slug, summaryCount) => {
        if (!(slug in observed)) observed[slug] = summaryCount;
      },
    });

    expect(observed.p0).toBe(0);
    expect(observed.p1).toBeGreaterThanOrEqual(1);
    expect(observed.p2).toBeGreaterThanOrEqual(2);
    expect(observed.p3).toBeGreaterThanOrEqual(3);
  });

  it("pageConcurrency=3 shorter wall time than pageConcurrency=1 on mocked latencies", async () => {
    const wiki: WikiJson = {
      summary: "test",
      reading_order: Array.from({ length: 6 }, (_, i) => ({
        slug: `p${i}`,
        title: `P${i}`,
        rationale: "r",
        covered_files: [`f${i}.ts`],
      })),
    };

    const t1 = await measureWallTime(wiki, { pageConcurrency: 1, stagedelayMs: 50 });
    const t3 = await measureWallTime(wiki, { pageConcurrency: 3, stagedelayMs: 50 });

    // Parallel must be noticeably faster (allow 60% tolerance for overhead)
    expect(t3).toBeLessThan(t1 * 0.7);
  });
});

// Helper stubs — implement using the same mock factories as generation-pipeline.test.ts.
// If that file does not expose them, copy the minimal scaffold needed. This
// section is intentionally thin because the mock machinery is large; reuse
// what already exists.
async function runFixture(
  _wiki: WikiJson,
  _opts: { pageConcurrency: number; onReviewerCalled?: (slug: string, summaryCount: number) => void },
): Promise<Array<{ slug: string; title: string; summary: string }>> {
  throw new Error(
    "TEST SCAFFOLD: Port the pipeline setup from generation-pipeline.test.ts " +
    "and inject opts.pageConcurrency via a patched quality profile.",
  );
}

async function measureWallTime(
  _wiki: WikiJson,
  _opts: { pageConcurrency: number; stagedelayMs: number },
): Promise<number> {
  throw new Error(
    "TEST SCAFFOLD: Stub each pipeline stage to sleep opts.stagedelayMs, " +
    "measure Date.now() around pipeline.run().",
  );
}
```

**Important:** The two helper functions `runFixture` and `measureWallTime` are intentionally left as scaffolds. The implementer must port them from the existing `generation-pipeline.test.ts` because the full mock machinery (models, artifact store, filesystem, prefetcher) is substantial and must match the patterns already in the codebase. Read `generation-pipeline.test.ts` top-to-bottom before implementing.

- [ ] **Step 3: Port scaffolding from generation-pipeline.test.ts**

Read `packages/core/src/generation/__tests__/generation-pipeline.test.ts` and copy/adapt its setup helpers so that `runFixture` and `measureWallTime` work. Concretely:

- Build a mocked pipeline with the provided `qp.pageConcurrency` override.
- `runFixture` should run the pipeline end-to-end and return the final `publishedSummaries` array from the job.
- `onReviewerCalled` hooks into the mock reviewer so each first-call captures `publishedSummaries.length` at the moment review is invoked.
- `measureWallTime` wraps `pipeline.run(...)` with `performance.now()` before/after, and injects a `sleep(stagedelayMs)` inside each mocked stage so wall time is measurable in deterministic CI.

- [ ] **Step 4: Run the new test, confirm PASS**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && pnpm --filter @reporead/core test -- generation-pipeline-parallel`
Expected: All 3 tests PASS. If the "shorter wall time" test is flaky, lower the concurrency factor or make the mocked stages heavier.

- [ ] **Step 5: Run full core tests**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && pnpm --filter @reporead/core test`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/generation/__tests__/generation-pipeline-parallel.test.ts
git commit -m "$(cat <<'EOF'
test(pipeline): parallel scheduler integration tests

Covers ordering invariant (p0..pN in published order), review-sees-summaries
invariant, and wall-time speedup at concurrency=3 over concurrency=1.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Add CLI `--page-concurrency` flag

**Files:**
- Modify: `packages/cli/src/commands/generate.tsx`

- [ ] **Step 1: Find the existing flag registration block**

Run: `grep -n "option(\|argument(\|\.version\|program\." packages/cli/src/commands/generate.tsx | head -30`

This reveals the CLI framework in use (commander / yargs / custom). Follow its pattern.

- [ ] **Step 2: Register the new flag**

Add a new option/flag. Example using commander-style:

```typescript
.option(
  "--page-concurrency <n>",
  "Max pages to run in parallel (1-5). Overrides preset default.",
  (value) => {
    const n = Number.parseInt(value, 10);
    if (!Number.isInteger(n) || n < 1 || n > 5) {
      throw new Error("--page-concurrency must be an integer in [1, 5]");
    }
    return n;
  },
)
```

Match the exact registration style of existing flags in the same file.

- [ ] **Step 3: Pipe the flag into the resolved quality profile**

Find where the resolved config / quality profile is constructed before `pipeline.run(...)` is called. Insert an override:

```typescript
if (opts.pageConcurrency != null) {
  resolvedConfig.qualityProfile = {
    ...resolvedConfig.qualityProfile,
    pageConcurrency: opts.pageConcurrency,
  };
}
```

The exact property name (`resolvedConfig.qualityProfile` vs similar) must match the local code — the line `grep -n qualityProfile packages/cli/src/commands/generate.tsx` locates it.

- [ ] **Step 4: Run CLI typecheck**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && pnpm --filter @reporead/cli typecheck`
Expected: No errors.

- [ ] **Step 5: Smoke-test the flag**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && node packages/cli/dist/index.js generate --help 2>&1 | grep page-concurrency`
Expected: flag appears in help output. If `dist/` is stale, run `pnpm --filter @reporead/cli build` first.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/commands/generate.tsx
git commit -m "$(cat <<'EOF'
feat(cli): --page-concurrency flag for generate command

Overrides qp.pageConcurrency (1-5). Default honors preset; quality=3.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: E2E smoke validation on repo-read

**Files:** no code — validation only.

- [ ] **Step 1: Build the monorepo**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && pnpm build`
Expected: All packages build cleanly.

- [ ] **Step 2: Baseline run at concurrency=1**

Run:
```bash
cd /Users/jyxc-dz-0100318/open_source/repo_read && \
node packages/cli/dist/index.js generate --preset quality --page-concurrency 1 2>&1 | tail -40
```

Record the `book_total_latency` / total wall time in the emitted events.

- [ ] **Step 3: Parallel run at concurrency=3**

Delete the prior throughput.json for a clean comparison, or use a fresh output dir. Run:

```bash
cd /Users/jyxc-dz-0100318/open_source/repo_read && \
node packages/cli/dist/index.js generate --preset quality --page-concurrency 3 2>&1 | tail -40
```

Record the wall time.

- [ ] **Step 4: Compare and verify**

- Wall time at `--page-concurrency 3` should be ≤ 50% of `--page-concurrency 1`.
- `publishedSummaries` in both runs' `events.ndjson` should have the same ordering.
- No `job.failed` events that weren't already present in the baseline.

- [ ] **Step 5: If wall-time target not met, investigate before proceeding**

Possible issues:
- Provider rate limiting — check for AI SDK retry warnings.
- A specific page is the bottleneck regardless of concurrency (long single-page revision loop); check throughput.json `pages[i].totalLatencyMs`.
- Scheduler miscounting — verify `prefetchHitRate` is still 1.0.

Do NOT commit E2E results; record them in a scratch note under `docs/superpowers/plans/2026-04-17-throughput-50pct-rollout-notes.md` if useful for subsequent tuning.

---

## Self-Review Checklist

**1. Spec coverage:**

| Spec section | Implementing task |
|---|---|
| §3 Evidence re-run cap (counter + `qp.maxEvidenceAttempts`) | Tasks 1, 2 |
| §4 Deep-lane revision bonus removal | Tasks 3, 4 |
| §5.1 `pageConcurrency` field | Task 7 |
| §5.2 ParallelPageScheduler + createGate | Task 6 |
| §5.3 Semaphore | Task 5 |
| §5.4 `runPageWorkflow` reviewGate + onFirstReviewStart | Task 8 |
| §5.5 Pipeline loop replaced with scheduler | Task 9 |
| §5.6 publishedSummaries read/write timing | Tasks 8, 9 (behavior preserved by reviewGate) |
| §5.7 Error propagation (single failure doesn't poison batch) | Task 6 (scheduler catches), Task 9 (first-failure aggregation) |
| §6 Test strategy (unit/integration/E2E) | Tasks 2, 5, 6, 10, 12 |
| §8 Rollback — concurrency=1 equivalent to serial | Task 9 Step 2 note + Task 10 first test |
| §11 File changes | Task plan file list matches |

No spec section left unimplemented.

**2. Placeholder scan:** The only intentional scaffold is in Task 10 Step 2 (`runFixture` and `measureWallTime` bodies). Step 3 explicitly instructs the engineer to port the scaffold from the existing `generation-pipeline.test.ts` mock factories — this is called out as a required action, not a hidden placeholder.

**3. Type consistency:**
- `QualityProfile` gets exactly 3 new fields (`maxEvidenceAttempts`, `deepLaneRevisionBonus`, `pageConcurrency`), introduced in Tasks 1, 3, 7 and consumed in Tasks 2, 4, 9 respectively.
- `Semaphore.acquire/release` signatures in Task 5 match usage in Task 6.
- `ParallelPageScheduler.runAll(pages, publishedSummaries)` signature in Task 6 matches call in Task 9.
- `PageRunContext.reviewGate: Promise<void>` + `onFirstReviewStart?: () => void` in Task 6 match the extension in Task 8 and the passthrough in Task 9.
- `PageRunResult.success / error / summary / pageMetrics` shape in Task 6 matches what Task 9 returns from the runPage closure.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-17-throughput-50pct-reduction.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
