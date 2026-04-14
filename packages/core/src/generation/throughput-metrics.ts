import type { UsageBucket } from "../utils/usage-tracker.js";
import type { UsageInput } from "../utils/usage-tracker.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ExecutionLane = "fast" | "standard" | "deep";

export type StageMetrics = {
  durationMs: number;
  usage: UsageBucket;
};

/** Per-phase metric recorded by the pipeline for throughput reports. */
export type PhaseMetric = {
  llmCalls: number;
  durationMs: number;
  usage: UsageInput;
  reused?: boolean;
};

/** Per-page throughput record with phase-level breakdown. */
export type PageThroughputRecord = {
  pageSlug: string;
  lane: ExecutionLane;
  totalLatencyMs: number;
  revisionAttempts: number;
  escalatedToDeepLane: boolean;
  phases: {
    evidence: PhaseMetric;
    outline: PhaseMetric;
    draft: PhaseMetric;
    review: PhaseMetric;
    validate: PhaseMetric;
  };
  usage: UsageBucket;
};

/** Top-level throughput report persisted as throughput.json. */
export type ThroughputReport = {
  catalog: PhaseMetric;
  pages: PageThroughputRecord[];
  totals: {
    llmCalls: number;
    totalLatencyMs: number;
    usage: UsageBucket;
  };
  reviewEscalationRate: number;
};

export type PageThroughputMetrics = {
  pageSlug: string;
  lane: ExecutionLane;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  stages: {
    evidence?: StageMetrics;
    outline?: StageMetrics;
    draft?: StageMetrics;
    review?: StageMetrics;
    validation?: StageMetrics;
  };
  totalUsage: UsageBucket;
};

export type JobThroughputMetrics = {
  jobId: string;
  projectSlug: string;
  totalPages: number;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  pages: PageThroughputMetrics[];
  byLane: Record<ExecutionLane, { count: number; totalDurationMs: number; totalUsage: UsageBucket }>;
  totalUsage: UsageBucket;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function zeroUsage(): UsageBucket {
  return {
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cachedTokens: 0,
    requests: 0,
  };
}

export function cloneUsage(u: UsageBucket): UsageBucket {
  return { ...u };
}

export function addUsage(target: UsageBucket, source: UsageBucket): void {
  target.inputTokens += source.inputTokens;
  target.outputTokens += source.outputTokens;
  target.reasoningTokens += source.reasoningTokens;
  target.cachedTokens += source.cachedTokens;
  target.requests += source.requests;
}

/** Like addUsage but accepts UsageInput (no `requests` field). */
export function addUsageInput(target: UsageInput, source: UsageInput): void {
  target.inputTokens += source.inputTokens;
  target.outputTokens += source.outputTokens;
  target.reasoningTokens += source.reasoningTokens;
  target.cachedTokens += source.cachedTokens;
}

// ---------------------------------------------------------------------------
// Collector
// ---------------------------------------------------------------------------

type PageBuilder = {
  pageSlug: string;
  lane: ExecutionLane;
  startedAt: Date;
  stages: PageThroughputMetrics["stages"];
};

export class ThroughputMetricsCollector {
  private jobStartedAt: Date = new Date();
  private totalPages: number = 0;
  private pages: PageThroughputMetrics[] = [];
  private activePages: Map<string, PageBuilder> = new Map();

  // Called once catalog planning finishes so we know the total page count
  setCatalog(totalPages: number): void {
    this.totalPages = totalPages;
  }

  // Start tracking a page
  addPage(pageSlug: string, lane: ExecutionLane): void {
    this.activePages.set(pageSlug, {
      pageSlug,
      lane,
      startedAt: new Date(),
      stages: {},
    });
  }

  // Record a completed stage for a page
  recordStage(
    pageSlug: string,
    stage: keyof PageThroughputMetrics["stages"],
    durationMs: number,
    usage: UsageBucket,
  ): void {
    const builder = this.activePages.get(pageSlug);
    if (!builder) return;
    builder.stages[stage] = { durationMs, usage: cloneUsage(usage) };
  }

  // Finish tracking a page and store its metrics
  finishPage(pageSlug: string): void {
    const builder = this.activePages.get(pageSlug);
    if (!builder) return;

    const finishedAt = new Date();
    const durationMs = finishedAt.getTime() - builder.startedAt.getTime();

    const totalUsage = zeroUsage();
    for (const stage of Object.values(builder.stages)) {
      if (stage) addUsage(totalUsage, stage.usage);
    }

    const metrics: PageThroughputMetrics = {
      pageSlug: builder.pageSlug,
      lane: builder.lane,
      startedAt: builder.startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs,
      stages: builder.stages,
      totalUsage,
    };

    this.pages.push(metrics);
    this.activePages.delete(pageSlug);
  }

  // Finalise and return the full job throughput report
  finish(jobId: string, projectSlug: string): JobThroughputMetrics {
    const finishedAt = new Date();
    const durationMs = finishedAt.getTime() - this.jobStartedAt.getTime();

    const byLane: Record<ExecutionLane, { count: number; totalDurationMs: number; totalUsage: UsageBucket }> = {
      fast: { count: 0, totalDurationMs: 0, totalUsage: zeroUsage() },
      standard: { count: 0, totalDurationMs: 0, totalUsage: zeroUsage() },
      deep: { count: 0, totalDurationMs: 0, totalUsage: zeroUsage() },
    };

    const totalUsage = zeroUsage();

    for (const page of this.pages) {
      const laneBucket = byLane[page.lane];
      laneBucket.count += 1;
      laneBucket.totalDurationMs += page.durationMs;
      addUsage(laneBucket.totalUsage, page.totalUsage);
      addUsage(totalUsage, page.totalUsage);
    }

    return {
      jobId,
      projectSlug,
      totalPages: this.totalPages,
      startedAt: this.jobStartedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs,
      pages: this.pages,
      byLane,
      totalUsage,
    };
  }
}

// ---------------------------------------------------------------------------
// ThroughputReportBuilder — builds the throughput.json report
// ---------------------------------------------------------------------------

export function zeroPhaseMetric(): PhaseMetric {
  return { llmCalls: 0, durationMs: 0, usage: { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cachedTokens: 0 } };
}

/**
 * Builds the `ThroughputReport` that gets persisted as `throughput.json`.
 * The pipeline creates one instance per job run, records the catalog phase,
 * then adds page-level throughput records as each page completes.
 */
export class ThroughputReportBuilder {
  private catalog: PhaseMetric = zeroPhaseMetric();
  private readonly pageRecords: PageThroughputRecord[] = [];

  setCatalog(metric: PhaseMetric): void {
    this.catalog = metric;
  }

  addPage(record: PageThroughputRecord): void {
    this.pageRecords.push(record);
  }

  finish(opts: { totalLatencyMs: number }): ThroughputReport {
    let totalLlmCalls = this.catalog.llmCalls;
    const totalUsage = zeroUsage();

    // Add catalog usage
    totalUsage.inputTokens += this.catalog.usage.inputTokens;
    totalUsage.outputTokens += this.catalog.usage.outputTokens;
    totalUsage.reasoningTokens += this.catalog.usage.reasoningTokens;
    totalUsage.cachedTokens += this.catalog.usage.cachedTokens;
    totalUsage.requests += this.catalog.llmCalls;

    for (const page of this.pageRecords) {
      for (const phase of Object.values(page.phases)) {
        totalLlmCalls += phase.llmCalls;
        totalUsage.inputTokens += phase.usage.inputTokens;
        totalUsage.outputTokens += phase.usage.outputTokens;
        totalUsage.reasoningTokens += phase.usage.reasoningTokens;
        totalUsage.cachedTokens += phase.usage.cachedTokens;
        totalUsage.requests += phase.llmCalls;
      }
    }

    const escalatedCount = this.pageRecords.filter(p => p.escalatedToDeepLane).length;
    const reviewEscalationRate = this.pageRecords.length > 0 ? escalatedCount / this.pageRecords.length : 0;

    return {
      catalog: this.catalog,
      pages: this.pageRecords,
      totals: {
        llmCalls: totalLlmCalls,
        totalLatencyMs: opts.totalLatencyMs,
        usage: totalUsage,
      },
      reviewEscalationRate,
    };
  }
}
