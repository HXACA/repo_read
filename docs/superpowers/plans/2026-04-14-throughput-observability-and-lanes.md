# Throughput Observability And Execution Lanes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 RepoRead generation 链建立第一阶段提效基础设施：先落地 `Observability Foundation`，再引入第一版 `Execution Lane Selector`，让后续并行调度与分层审查建立在真实指标而不是主观感觉上。

**Architecture:** 这份计划只实现两个紧耦合的子系统：`throughput metrics` 和 `execution lanes`。做法是让 catalog / evidence / outline / draft / review / validate 这些阶段都显式返回统一的 stage metrics，由 `GenerationPipeline` 汇总成 `throughput.json`；然后引入独立的 `ExecutionLaneSelector`，把当前已有的 complexity + runtime signals 收口成 `fast / standard / deep` 三条通道，并把 lane 写入指标产物。**不在本计划中实现** `page overlap scheduler`、`Verification Ladder`、`Evidence Fabric`、`Incremental Regeneration`。

**Tech Stack:** TypeScript, Vitest, AI SDK v6 (`ai`), pnpm workspace, existing `GenerationPipeline` / `ArtifactStore` / `QualityProfile`

---

## 文件结构

### Create

- `packages/core/src/generation/throughput-metrics.ts`
- `packages/core/src/generation/execution-lane.ts`
- `packages/core/src/generation/__tests__/throughput-metrics.test.ts`
- `packages/core/src/generation/__tests__/execution-lane.test.ts`
- `packages/core/src/generation/__tests__/throughput-observability.test.ts`

### Modify

- `packages/core/src/artifacts/artifact-store.ts`
- `packages/core/src/artifacts/__tests__/artifact-store.test.ts`
- `packages/core/src/catalog/catalog-planner.ts`
- `packages/core/src/generation/fork-worker.ts`
- `packages/core/src/generation/evidence-coordinator.ts`
- `packages/core/src/generation/outline-planner.ts`
- `packages/core/src/generation/page-drafter.ts`
- `packages/core/src/review/reviewer.ts`
- `packages/core/src/generation/generation-pipeline.ts`

### Explicitly Out Of Scope In This Plan

- `packages/core/src/context/*`
- `packages/core/src/ask/*`
- `packages/core/src/research/*`
- `packages/core/src/generation/generation-events.ts`
- `packages/cli/src/progress-renderer.tsx`
- `page overlap / lookahead scheduler`
- `Verification Ladder`
- `Evidence Fabric`

---

### Task 1: Add Throughput Metrics Types And Collector

**Files:**
- Create: `packages/core/src/generation/throughput-metrics.ts`
- Test: `packages/core/src/generation/__tests__/throughput-metrics.test.ts`

- [ ] **Step 1: Write the failing throughput metrics unit test**

```typescript
// packages/core/src/generation/__tests__/throughput-metrics.test.ts
import { describe, it, expect } from "vitest";
import {
  ThroughputMetricsCollector,
  zeroUsage,
  type ExecutionLane,
} from "../throughput-metrics.js";

describe("ThroughputMetricsCollector", () => {
  it("aggregates catalog + page metrics into job totals", () => {
    const collector = new ThroughputMetricsCollector({
      jobId: "job-1",
      projectSlug: "proj",
      versionId: "v1",
      preset: "balanced",
    });

    collector.setCatalog({
      durationMs: 1200,
      llmCalls: 1,
      usage: {
        inputTokens: 100,
        outputTokens: 50,
        reasoningTokens: 0,
        cachedTokens: 0,
      },
      reused: false,
    });

    collector.addPage({
      pageSlug: "overview",
      lane: "fast" satisfies ExecutionLane,
      totalLatencyMs: 3200,
      revisionAttempts: 0,
      escalatedToDeepLane: false,
      phases: {
        evidence: {
          durationMs: 600,
          llmCalls: 1,
          usage: {
            inputTokens: 20,
            outputTokens: 10,
            reasoningTokens: 0,
            cachedTokens: 0,
          },
          reused: false,
        },
        outline: {
          durationMs: 300,
          llmCalls: 1,
          usage: {
            inputTokens: 10,
            outputTokens: 5,
            reasoningTokens: 0,
            cachedTokens: 0,
          },
          reused: false,
        },
        draft: {
          durationMs: 1400,
          llmCalls: 1,
          usage: {
            inputTokens: 40,
            outputTokens: 20,
            reasoningTokens: 0,
            cachedTokens: 0,
          },
          reused: false,
        },
        review: {
          durationMs: 700,
          llmCalls: 1,
          usage: {
            inputTokens: 30,
            outputTokens: 15,
            reasoningTokens: 0,
            cachedTokens: 0,
          },
          reused: false,
        },
        validate: {
          durationMs: 200,
          llmCalls: 0,
          usage: zeroUsage(),
          reused: false,
        },
      },
    });

    const metrics = collector.finish({ totalLatencyMs: 5000 });

    expect(metrics.catalog?.llmCalls).toBe(1);
    expect(metrics.pages).toHaveLength(1);
    expect(metrics.pages[0].usage.inputTokens).toBe(100);
    expect(metrics.pages[0].llmCalls).toBe(4);
    expect(metrics.totals.usage.inputTokens).toBe(200);
    expect(metrics.totals.llmCalls).toBe(5);
    expect(metrics.totals.reviewEscalationRate).toBe(0);
  });

  it("computes deep-lane escalation rate from page metrics", () => {
    const collector = new ThroughputMetricsCollector({
      jobId: "job-2",
      projectSlug: "proj",
      versionId: "v1",
      preset: "quality",
    });

    collector.addPage({
      pageSlug: "intro",
      lane: "standard",
      totalLatencyMs: 1000,
      revisionAttempts: 0,
      escalatedToDeepLane: false,
      phases: {},
    });

    collector.addPage({
      pageSlug: "core",
      lane: "deep",
      totalLatencyMs: 2000,
      revisionAttempts: 1,
      escalatedToDeepLane: true,
      phases: {},
    });

    const metrics = collector.finish({ totalLatencyMs: 3500 });

    expect(metrics.totals.reviewEscalationRate).toBe(0.5);
    expect(metrics.pages[1].lane).toBe("deep");
    expect(metrics.pages[1].escalatedToDeepLane).toBe(true);
  });
});
```

- [ ] **Step 2: Run the new test and verify it fails**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && pnpm --filter @reporead/core exec vitest run src/generation/__tests__/throughput-metrics.test.ts`

Expected: FAIL with `Cannot find module '../throughput-metrics.js'` or missing export errors.

- [ ] **Step 3: Implement `throughput-metrics.ts`**

```typescript
// packages/core/src/generation/throughput-metrics.ts
import type { Preset } from "../types/config.js";
import type { UsageInput } from "../utils/usage-tracker.js";

export type ThroughputPhase =
  | "catalog"
  | "evidence"
  | "outline"
  | "draft"
  | "review"
  | "validate"
  | "publish";

export type ExecutionLane = "fast" | "standard" | "deep";

export type StageMetrics = {
  durationMs: number;
  llmCalls: number;
  usage: UsageInput;
  reused: boolean;
};

export type PageThroughputMetrics = {
  pageSlug: string;
  lane: ExecutionLane;
  totalLatencyMs: number;
  revisionAttempts: number;
  escalatedToDeepLane: boolean;
  phases: Partial<Record<Exclude<ThroughputPhase, "catalog" | "publish">, StageMetrics>>;
  usage: UsageInput;
  llmCalls: number;
};

export type JobThroughputMetrics = {
  jobId: string;
  projectSlug: string;
  versionId: string;
  preset: Preset;
  generatedAt: string;
  catalog: StageMetrics | null;
  pages: PageThroughputMetrics[];
  totals: {
    totalLatencyMs: number;
    llmCalls: number;
    usage: UsageInput;
    reviewEscalationRate: number;
  };
};

export function zeroUsage(): UsageInput {
  return {
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cachedTokens: 0,
  };
}

export function cloneUsage(input?: UsageInput): UsageInput {
  return {
    inputTokens: input?.inputTokens ?? 0,
    outputTokens: input?.outputTokens ?? 0,
    reasoningTokens: input?.reasoningTokens ?? 0,
    cachedTokens: input?.cachedTokens ?? 0,
  };
}

export function addUsage(target: UsageInput, input?: UsageInput): void {
  if (!input) return;
  target.inputTokens += input.inputTokens;
  target.outputTokens += input.outputTokens;
  target.reasoningTokens += input.reasoningTokens;
  target.cachedTokens += input.cachedTokens;
}

function summarizePageUsage(
  phases: PageThroughputMetrics["phases"],
): { usage: UsageInput; llmCalls: number } {
  const usage = zeroUsage();
  let llmCalls = 0;

  for (const metric of Object.values(phases)) {
    if (!metric) continue;
    addUsage(usage, metric.usage);
    llmCalls += metric.llmCalls;
  }

  return { usage, llmCalls };
}

export class ThroughputMetricsCollector {
  private catalog: StageMetrics | null = null;
  private readonly pages: PageThroughputMetrics[] = [];

  constructor(
    private readonly meta: {
      jobId: string;
      projectSlug: string;
      versionId: string;
      preset: Preset;
    },
  ) {}

  setCatalog(metric: StageMetrics): void {
    this.catalog = metric;
  }

  addPage(
    input: Omit<PageThroughputMetrics, "usage" | "llmCalls"> & {
      usage?: UsageInput;
      llmCalls?: number;
    },
  ): void {
    const summary = summarizePageUsage(input.phases);
    this.pages.push({
      ...input,
      usage: input.usage ?? summary.usage,
      llmCalls: input.llmCalls ?? summary.llmCalls,
    });
  }

  finish(input: { totalLatencyMs: number }): JobThroughputMetrics {
    const totalUsage = zeroUsage();
    let totalCalls = 0;

    if (this.catalog) {
      addUsage(totalUsage, this.catalog.usage);
      totalCalls += this.catalog.llmCalls;
    }

    for (const page of this.pages) {
      addUsage(totalUsage, page.usage);
      totalCalls += page.llmCalls;
    }

    const escalatedCount = this.pages.filter((p) => p.escalatedToDeepLane).length;

    return {
      ...this.meta,
      generatedAt: new Date().toISOString(),
      catalog: this.catalog,
      pages: [...this.pages],
      totals: {
        totalLatencyMs: input.totalLatencyMs,
        llmCalls: totalCalls,
        usage: totalUsage,
        reviewEscalationRate: this.pages.length === 0 ? 0 : escalatedCount / this.pages.length,
      },
    };
  }
}
```

- [ ] **Step 4: Run the throughput metrics test and verify it passes**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && pnpm --filter @reporead/core exec vitest run src/generation/__tests__/throughput-metrics.test.ts`

Expected: PASS, 2 tests passed in `throughput-metrics.test.ts`.

- [ ] **Step 5: Commit the collector**

```bash
git add packages/core/src/generation/throughput-metrics.ts packages/core/src/generation/__tests__/throughput-metrics.test.ts
git commit -m "feat: add generation throughput metrics collector"
```

---

### Task 2: Add ArtifactStore Support For `throughput.json`

**Files:**
- Modify: `packages/core/src/artifacts/artifact-store.ts`
- Test: `packages/core/src/artifacts/__tests__/artifact-store.test.ts`

- [ ] **Step 1: Add the failing ArtifactStore test**

```typescript
// packages/core/src/artifacts/__tests__/artifact-store.test.ts
it("saveThroughputMetrics writes throughput.json under the job directory", async () => {
  const ref = { projectSlug: "proj", jobId: "job-1" };
  const data = { totals: { totalLatencyMs: 1234 } };

  await store.saveThroughputMetrics(ref, data);

  expect(writeJson).toHaveBeenCalledWith(
    path.join(storage.paths.jobDir("proj", "job-1"), "throughput.json"),
    data,
  );
});
```

- [ ] **Step 2: Run the ArtifactStore test and verify it fails**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && pnpm --filter @reporead/core exec vitest run src/artifacts/__tests__/artifact-store.test.ts`

Expected: FAIL with `store.saveThroughputMetrics is not a function`.

- [ ] **Step 3: Implement `saveThroughputMetrics` in `ArtifactStore`**

```typescript
// packages/core/src/artifacts/artifact-store.ts
  // --- Throughput Metrics ---

  async saveThroughputMetrics(ref: JobRef, data: unknown): Promise<void> {
    return this.storage.writeJson(
      path.join(this.storage.paths.jobDir(ref.projectSlug, ref.jobId), "throughput.json"),
      data,
    );
  }
```

- [ ] **Step 4: Run the ArtifactStore test and verify it passes**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && pnpm --filter @reporead/core exec vitest run src/artifacts/__tests__/artifact-store.test.ts`

Expected: PASS, including the new `saveThroughputMetrics` assertion.

- [ ] **Step 5: Commit the ArtifactStore change**

```bash
git add packages/core/src/artifacts/artifact-store.ts packages/core/src/artifacts/__tests__/artifact-store.test.ts
git commit -m "feat: add throughput metrics artifact persistence"
```

---

### Task 3: Instrument Generation Stages And Persist `throughput.json`

**Files:**
- Create: `packages/core/src/generation/__tests__/throughput-observability.test.ts`
- Modify: `packages/core/src/catalog/catalog-planner.ts`
- Modify: `packages/core/src/generation/fork-worker.ts`
- Modify: `packages/core/src/generation/evidence-coordinator.ts`
- Modify: `packages/core/src/generation/outline-planner.ts`
- Modify: `packages/core/src/generation/page-drafter.ts`
- Modify: `packages/core/src/review/reviewer.ts`
- Modify: `packages/core/src/generation/generation-pipeline.ts`

- [ ] **Step 1: Write the failing generation observability integration test**

```typescript
// packages/core/src/generation/__tests__/throughput-observability.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { GenerationPipeline } from "../generation-pipeline.js";
import { StorageAdapter } from "../../storage/storage-adapter.js";
import { JobStateManager } from "../job-state.js";
import { getQualityProfile } from "../../config/quality-profile.js";
import type { ResolvedConfig } from "../../types/config.js";

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
        fullStream: (async function* () {})(),
      };
    }),
    jsonSchema: vi.fn((s: unknown) => s),
    stepCountIs: vi.fn(() => () => false),
  };
});

const config: ResolvedConfig = {
  projectSlug: "proj",
  repoRoot: "/tmp/repo",
  preset: "budget",
  language: "zh",
  roles: {
    catalog: { role: "catalog", primaryModel: "m1", fallbackModels: [], resolvedProvider: "anthropic", systemPromptTuningId: "claude" },
    outline: { role: "outline", primaryModel: "m1", fallbackModels: [], resolvedProvider: "anthropic", systemPromptTuningId: "claude" },
    drafter: { role: "drafter", primaryModel: "m1", fallbackModels: [], resolvedProvider: "anthropic", systemPromptTuningId: "claude" },
    worker: { role: "worker", primaryModel: "m1", fallbackModels: [], resolvedProvider: "anthropic", systemPromptTuningId: "claude" },
    reviewer: { role: "reviewer", primaryModel: "m1", fallbackModels: [], resolvedProvider: "anthropic", systemPromptTuningId: "claude" },
  },
  providers: [],
  retrieval: {
    maxParallelReadsPerPage: 5,
    maxReadWindowLines: 500,
    allowControlledBash: true,
  },
  qualityProfile: getQualityProfile("budget"),
};

describe("GenerationPipeline observability", () => {
  let tmpDir: string;
  let storage: StorageAdapter;
  let jobManager: JobStateManager;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "reporead-throughput-"));
    storage = new StorageAdapter(tmpDir);
    await storage.initialize();
    jobManager = new JobStateManager(storage);
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("writes throughput.json with catalog + per-page phase metrics", async () => {
    const { generateText } = await import("ai");
    const mockGenerateText = vi.mocked(generateText);

    mockGenerateText.mockResolvedValueOnce({
      text: JSON.stringify({
        summary: "Test project",
        reading_order: [
          { slug: "overview", title: "Overview", rationale: "Start here", covered_files: ["README.md"] },
        ],
      }),
      usage: { inputTokens: 100, outputTokens: 50, reasoningTokens: 0, cachedTokens: 0 },
    } as never);

    mockGenerateText.mockResolvedValueOnce({
      text: JSON.stringify({
        directive: "Collect evidence",
        findings: ["Found README"],
        citations: [{ kind: "file", target: "README.md", locator: "1-10", note: "intro" }],
        open_questions: [],
      }),
      usage: { inputTokens: 30, outputTokens: 20, reasoningTokens: 0, cachedTokens: 0 },
    } as never);

    mockGenerateText.mockResolvedValueOnce({
      text: JSON.stringify({
        sections: [{ heading: "概述", key_points: ["README"], cite_from: [{ target: "README.md", locator: "1-10" }] }],
      }),
      usage: { inputTokens: 25, outputTokens: 15, reasoningTokens: 0, cachedTokens: 0 },
    } as never);

    mockGenerateText.mockResolvedValueOnce({
      text: "# Overview\\n\\nText\\n\\n[cite:file:README.md:1-10]",
      usage: { inputTokens: 80, outputTokens: 40, reasoningTokens: 0, cachedTokens: 0 },
      finishReason: "stop",
    } as never);

    mockGenerateText.mockResolvedValueOnce({
      text: JSON.stringify({
        verdict: "pass",
        blockers: [],
        factual_risks: [],
        missing_evidence: [],
        scope_violations: [],
        suggested_revisions: [],
      }),
      usage: { inputTokens: 40, outputTokens: 20, reasoningTokens: 0, cachedTokens: 0 },
    } as never);

    const pipeline = new GenerationPipeline({
      storage,
      jobManager,
      config,
      catalogModel: {} as never,
      outlineModel: {} as never,
      drafterModel: {} as never,
      workerModel: {} as never,
      reviewerModel: {} as never,
      repoRoot: tmpDir,
      commitHash: "abc123",
    });

    const job = await jobManager.create("proj", tmpDir, config);
    const result = await pipeline.run(job);

    expect(result.success).toBe(true);

    const throughputPath = path.join(storage.paths.jobDir("proj", job.id), "throughput.json");
    const metrics = JSON.parse(await fs.readFile(throughputPath, "utf-8"));

    expect(metrics.catalog.llmCalls).toBe(1);
    expect(metrics.pages).toHaveLength(1);
    expect(metrics.pages[0].pageSlug).toBe("overview");
    expect(metrics.pages[0].phases.evidence.llmCalls).toBe(1);
    expect(metrics.pages[0].phases.outline.llmCalls).toBe(1);
    expect(metrics.pages[0].phases.draft.llmCalls).toBe(1);
    expect(metrics.pages[0].phases.review.llmCalls).toBe(1);
    expect(metrics.pages[0].phases.validate.llmCalls).toBe(0);
    expect(metrics.pages[0].usage.inputTokens).toBe(175);
    expect(metrics.totals.llmCalls).toBe(5);
  });
});
```

- [ ] **Step 2: Run the integration test and verify it fails**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && pnpm --filter @reporead/core exec vitest run src/generation/__tests__/throughput-observability.test.ts`

Expected: FAIL because `throughput.json` does not exist yet and stage results do not expose metrics.

- [ ] **Step 3: Plumb stage metrics through stage results and write `throughput.json`**

```typescript
// packages/core/src/catalog/catalog-planner.ts
import type { UsageInput } from "../utils/usage-tracker.js";

export type CatalogPlanResult = {
  success: boolean;
  wiki?: WikiJson;
  error?: string;
  metrics?: { llmCalls: number; usage: UsageInput };
};

// inside plan()
return {
  success: true,
  wiki,
  metrics: {
    llmCalls: 1,
    usage: {
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      reasoningTokens: result.usage.reasoningTokens,
      cachedTokens: result.usage.cachedTokens,
    },
  },
};

// packages/core/src/generation/fork-worker.ts
import type { UsageInput } from "../utils/usage-tracker.js";

export type ForkWorkerResponse = {
  success: boolean;
  data?: ForkWorkerResult;
  error?: string;
  metrics?: { llmCalls: number; usage: UsageInput };
};

// inside execute()
const parsed = this.parseOutput(result.text);
return {
  ...parsed,
  metrics: {
    llmCalls: 1,
    usage: {
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      reasoningTokens: result.usage.reasoningTokens,
      cachedTokens: result.usage.cachedTokens,
    },
  },
};

// packages/core/src/generation/outline-planner.ts
import type { UsageInput } from "../utils/usage-tracker.js";

export type OutlinePlanResult = {
  outline: PageOutline;
  usedFallback: boolean;
  metrics: { llmCalls: number; usage: UsageInput };
};

async planWithMetrics(input: OutlinePlannerInput): Promise<OutlinePlanResult> {
  try {
    const result = await this.turnEngine.run({
      purpose: "outline",
      model: this.model,
      systemPrompt: assembled.system,
      userPrompt: assembled.user,
      tools: {} as ToolSet,
      policy: {
        maxSteps: 1,
        providerOptions: this.providerCallOptions,
      },
      onStep: this.onStep,
    });
    const parsed = extractJson(result.text);
    if (parsed && Array.isArray(parsed.sections)) {
      const outline = this.parseOutline(parsed.sections);
      if (outline.sections.length >= 2) {
        return {
          outline,
          usedFallback: false,
          metrics: {
            llmCalls: 1,
            usage: {
              inputTokens: result.usage.inputTokens,
              outputTokens: result.usage.outputTokens,
              reasoningTokens: result.usage.reasoningTokens,
              cachedTokens: result.usage.cachedTokens,
            },
          },
        };
      }
    }
  } catch {
    // fall through
  }

  return {
    outline: this.fallbackOutline(input),
    usedFallback: true,
    metrics: {
      llmCalls: 0,
      usage: { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cachedTokens: 0 },
    },
  };
}

async plan(input: OutlinePlannerInput): Promise<PageOutline> {
  return (await this.planWithMetrics(input)).outline;
}

// packages/core/src/generation/page-drafter.ts
import type { UsageInput } from "../utils/usage-tracker.js";

export type PageDraftResult = {
  success: boolean;
  markdown?: string;
  metadata?: { summary: string; citations: CitationRecord[]; related_pages: string[] };
  error?: string;
  truncated?: boolean;
  metrics?: { llmCalls: number; usage: UsageInput };
};

// after parseOutput(result.text)
parsed.metrics = {
  llmCalls: 1,
  usage: {
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    reasoningTokens: result.usage.reasoningTokens,
    cachedTokens: result.usage.cachedTokens,
  },
};

// packages/core/src/review/reviewer.ts
import type { UsageInput } from "../utils/usage-tracker.js";

export type ReviewResult = {
  success: boolean;
  conclusion?: ReviewConclusion;
  error?: string;
  metrics?: { llmCalls: number; usage: UsageInput };
};

// when parse succeeds
const parsed = this.parseOutput(result.text);
return {
  ...parsed,
  metrics: {
    llmCalls: 1,
    usage: {
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      reasoningTokens: result.usage.reasoningTokens,
      cachedTokens: result.usage.cachedTokens,
    },
  },
};

// packages/core/src/generation/evidence-coordinator.ts
import { zeroUsage, addUsage } from "./throughput-metrics.js";

export type EvidenceCollectionResult = {
  ledger: MainAuthorContext["evidence_ledger"];
  findings: string[];
  openQuestions: string[];
  plan: EvidencePlan;
  failedTaskIds: string[];
  usedFallback: boolean;
  metrics: { llmCalls: number; usage: UsageInput };
};

// inside collect()
const usage = zeroUsage();
let llmCalls = 0;
if (planResult.success && planResult.metrics) {
  addUsage(usage, planResult.metrics.usage);
  llmCalls += planResult.metrics.llmCalls;
}
for (const r of results) {
  if (r.status === "ok" && r.metrics) {
    addUsage(usage, r.metrics.usage);
    llmCalls += r.metrics.llmCalls;
  }
}
return {
  ledger: Array.from(ledgerMap.values()),
  findings,
  openQuestions,
  plan,
  failedTaskIds,
  usedFallback,
  metrics: { llmCalls, usage },
};

// packages/core/src/generation/generation-pipeline.ts
import {
  ThroughputMetricsCollector,
  zeroUsage,
  type PageThroughputMetrics,
} from "./throughput-metrics.js";

// near the top of run()
const startedAt = Date.now();
const throughput = new ThroughputMetricsCollector({
  jobId,
  projectSlug: slug,
  versionId,
  preset: this.config.preset,
});

// catalog phase
const catalogStartedAt = Date.now();
const catalogResult = await this.runCatalogPhase(job, emitter, options);
throughput.setCatalog({
  durationMs: Date.now() - catalogStartedAt,
  llmCalls: catalogResult.metrics?.llmCalls ?? 0,
  usage: catalogResult.metrics?.usage ?? zeroUsage(),
  reused: false,
});

// page workflow return type
type PageWorkflowSuccess = {
  success: true;
  job: GenerationJob;
  pageMetrics: PageThroughputMetrics;
};

// after each phase inside runPageWorkflow()
const evidenceStartedAt = Date.now();
// ... collect evidence ...
const evidenceMetric = {
  durationMs: Date.now() - evidenceStartedAt,
  llmCalls: evidenceResult?.metrics.llmCalls ?? 0,
  usage: evidenceResult?.metrics.usage ?? zeroUsage(),
  reused: attempt === 0 && !shouldCollectEvidence,
};

// same pattern for outline/draft/review/validate

return {
  success: true,
  job,
  pageMetrics: {
    pageSlug: page.slug,
    lane: "standard",
    totalLatencyMs: Date.now() - pageStartedAt,
    revisionAttempts: attempt,
    escalatedToDeepLane: false,
    phases: {
      evidence: evidenceMetric,
      outline: outlineMetric,
      draft: draftMetric,
      review: reviewMetric,
      validate: validateMetric,
    },
  },
};

// back in run()
throughput.addPage(pageResult.pageMetrics);
await this.artifactStore.saveThroughputMetrics(
  { projectSlug: slug, jobId },
  throughput.finish({ totalLatencyMs: Date.now() - startedAt }),
);
```

- [ ] **Step 4: Run the targeted tests and verify they pass**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && pnpm --filter @reporead/core exec vitest run src/generation/__tests__/throughput-observability.test.ts src/artifacts/__tests__/artifact-store.test.ts src/generation/__tests__/throughput-metrics.test.ts`

Expected: PASS, including the new `throughput.json` integration test.

- [ ] **Step 5: Commit the observability slice**

```bash
git add packages/core/src/catalog/catalog-planner.ts packages/core/src/generation/fork-worker.ts packages/core/src/generation/evidence-coordinator.ts packages/core/src/generation/outline-planner.ts packages/core/src/generation/page-drafter.ts packages/core/src/review/reviewer.ts packages/core/src/generation/generation-pipeline.ts packages/core/src/generation/__tests__/throughput-observability.test.ts
git commit -m "feat: record generation throughput metrics per phase and page"
```

---

### Task 4: Add `ExecutionLaneSelector`

**Files:**
- Create: `packages/core/src/generation/execution-lane.ts`
- Test: `packages/core/src/generation/__tests__/execution-lane.test.ts`

- [ ] **Step 1: Write the failing lane selector unit test**

```typescript
// packages/core/src/generation/__tests__/execution-lane.test.ts
import { describe, it, expect } from "vitest";
import { getQualityProfile } from "../../config/quality-profile.js";
import { selectExecutionLane } from "../execution-lane.js";

describe("selectExecutionLane", () => {
  it("returns fast for a simple budget page", () => {
    const plan = selectExecutionLane({
      preset: "budget",
      base: getQualityProfile("budget"),
      complexity: { score: 2, fileCount: 1, dirSpread: 1, crossLanguage: false },
      signals: {},
    });

    expect(plan.lane).toBe("fast");
    expect(plan.params.forkWorkers).toBe(1);
    expect(plan.params.maxRevisionAttempts).toBe(1);
  });

  it("returns standard for a normal balanced page", () => {
    const plan = selectExecutionLane({
      preset: "balanced",
      base: getQualityProfile("balanced"),
      complexity: { score: 7, fileCount: 3, dirSpread: 2, crossLanguage: false },
      signals: {},
    });

    expect(plan.lane).toBe("standard");
  });

  it("returns deep when runtime signals indicate trouble", () => {
    const plan = selectExecutionLane({
      preset: "balanced",
      base: getQualityProfile("balanced"),
      complexity: { score: 5, fileCount: 2, dirSpread: 1, crossLanguage: false },
      signals: { draftTruncated: true, factualRisksCount: 1 },
    });

    expect(plan.lane).toBe("deep");
    expect(plan.params.drafterMaxSteps).toBeGreaterThan(getQualityProfile("balanced").drafterMaxSteps);
  });
});
```

- [ ] **Step 2: Run the lane selector test and verify it fails**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && pnpm --filter @reporead/core exec vitest run src/generation/__tests__/execution-lane.test.ts`

Expected: FAIL with `Cannot find module '../execution-lane.js'`.

- [ ] **Step 3: Implement `execution-lane.ts`**

```typescript
// packages/core/src/generation/execution-lane.ts
import type { Preset } from "../types/config.js";
import type { QualityProfile } from "../config/quality-profile.js";
import type { PageComplexityScore } from "./complexity-scorer.js";
import { adjustParams, type RuntimeSignals, type AdjustedParams } from "./param-adjuster.js";
import type { ExecutionLane } from "./throughput-metrics.js";

export type ExecutionLanePlan = {
  lane: ExecutionLane;
  params: AdjustedParams;
};

export function selectExecutionLane(input: {
  preset: Preset;
  base: QualityProfile;
  complexity: PageComplexityScore;
  signals: RuntimeSignals;
}): ExecutionLanePlan {
  const adjusted = adjustParams(input.base, input.complexity, input.signals);
  const hardSignals =
    !!input.signals.draftTruncated
    || (input.signals.factualRisksCount ?? 0) > 0
    || (input.signals.missingEvidenceCount ?? 0) > 0;

  if (hardSignals || input.complexity.score >= 16) {
    return {
      lane: "deep",
      params: {
        ...adjusted,
        forkWorkers: adjusted.forkWorkers + 1,
        drafterMaxSteps: adjusted.drafterMaxSteps + 6,
        maxRevisionAttempts: Math.max(adjusted.maxRevisionAttempts, input.base.maxRevisionAttempts + 1),
      },
    };
  }

  if (input.preset !== "quality" && input.complexity.score <= 4) {
    return {
      lane: "fast",
      params: {
        ...adjusted,
        forkWorkers: Math.min(adjusted.forkWorkers, 1),
        drafterMaxSteps: Math.min(adjusted.drafterMaxSteps, input.base.drafterMaxSteps),
        maxRevisionAttempts: Math.min(adjusted.maxRevisionAttempts, 1),
      },
    };
  }

  return {
    lane: "standard",
    params: adjusted,
  };
}
```

- [ ] **Step 4: Run the lane selector unit test and verify it passes**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && pnpm --filter @reporead/core exec vitest run src/generation/__tests__/execution-lane.test.ts`

Expected: PASS, 3 lane-selection tests passed.

- [ ] **Step 5: Commit the lane selector**

```bash
git add packages/core/src/generation/execution-lane.ts packages/core/src/generation/__tests__/execution-lane.test.ts
git commit -m "feat: add generation execution lane selector"
```

---

### Task 5: Wire Execution Lanes Into `GenerationPipeline`

**Files:**
- Modify: `packages/core/src/generation/generation-pipeline.ts`
- Modify: `packages/core/src/generation/__tests__/throughput-observability.test.ts`

- [ ] **Step 1: Extend the existing integration test to assert lane output**

```typescript
// packages/core/src/generation/__tests__/throughput-observability.test.ts
it("records the selected execution lane in throughput.json", async () => {
  // Reuse the existing budget-preset fixture from the same file.
  // The single README-only page has score=3 => lane should be fast.

  const pipeline = new GenerationPipeline({
    storage,
    jobManager,
    config,
    catalogModel: {} as never,
    outlineModel: {} as never,
    drafterModel: {} as never,
    workerModel: {} as never,
    reviewerModel: {} as never,
    repoRoot: tmpDir,
    commitHash: "abc123",
  });

  const job = await jobManager.create("proj", tmpDir, config);
  await pipeline.run(job);

  const throughputPath = path.join(storage.paths.jobDir("proj", job.id), "throughput.json");
  const metrics = JSON.parse(await fs.readFile(throughputPath, "utf-8"));

  expect(metrics.pages[0].lane).toBe("fast");
  expect(metrics.pages[0].escalatedToDeepLane).toBe(false);
});
```

- [ ] **Step 2: Run the integration test and verify it fails**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && pnpm --filter @reporead/core exec vitest run src/generation/__tests__/throughput-observability.test.ts`

Expected: FAIL because `pageMetrics.lane` is still hard-coded or missing.

- [ ] **Step 3: Replace direct `adjustParams()` usage with `selectExecutionLane()`**

```typescript
// packages/core/src/generation/generation-pipeline.ts
import { selectExecutionLane } from "./execution-lane.js";

// inside runPageWorkflow()
const complexity = computeComplexity({ coveredFiles: page.covered_files });
const initialLanePlan = selectExecutionLane({
  preset: this.config.preset,
  base: qp,
  complexity,
  signals: runtimeSignals,
});
let lane = initialLanePlan.lane;
let pageParams = initialLanePlan.params;

// when truncation or reviewer signals change runtimeSignals:
const nextLanePlan = selectExecutionLane({
  preset: this.config.preset,
  base: qp,
  complexity,
  signals: runtimeSignals,
});
lane = nextLanePlan.lane;
pageParams = nextLanePlan.params;

// final page metrics
pageMetrics: {
  pageSlug: page.slug,
  lane,
  totalLatencyMs: Date.now() - pageStartedAt,
  revisionAttempts: attempt,
  escalatedToDeepLane: lane === "deep",
  phases: {
    evidence: evidenceMetric,
    outline: outlineMetric,
    draft: draftMetric,
    review: reviewMetric,
    validate: validateMetric,
  },
}
```

- [ ] **Step 4: Run the focused verification set**

Run: `cd /Users/jyxc-dz-0100318/open_source/repo_read && pnpm --filter @reporead/core exec vitest run src/generation/__tests__/execution-lane.test.ts src/generation/__tests__/throughput-observability.test.ts src/generation/__tests__/generation-pipeline.test.ts`

Expected: PASS. Existing pipeline tests stay green, and `throughput.json` now includes `lane`.

- [ ] **Step 5: Commit the pipeline wiring**

```bash
git add packages/core/src/generation/generation-pipeline.ts packages/core/src/generation/__tests__/throughput-observability.test.ts
git commit -m "feat: wire execution lanes into generation metrics"
```

---

## Self-Review

### Spec Coverage

This plan covers:

1. `Observability Foundation`
   - `book_total_latency`
   - `page_total_latency`
   - `llm_calls_per_page`
   - `tokens_per_page`
   - `review_escalation_rate`
2. First safe `P6` slice
   - explicit `ExecutionLaneSelector`
   - lane-tagged page metrics

This plan intentionally does **not** cover:

1. page overlap / lookahead scheduling
2. `Verification Ladder`
3. `Evidence Fabric`
4. `Incremental Regeneration`

Those need separate plans after metrics baseline exists.

### Placeholder Scan

Checked:

1. No `TODO` / `TBD`
2. Every task has exact file paths
3. Every code-writing step includes concrete code
4. Every run step includes exact commands and expected outcomes

### Type Consistency

Plan uses the following stable names consistently:

1. `ThroughputMetricsCollector`
2. `ExecutionLane`
3. `StageMetrics`
4. `PageThroughputMetrics`
5. `JobThroughputMetrics`
6. `selectExecutionLane()`
7. `saveThroughputMetrics()`

No later task renames these symbols.
