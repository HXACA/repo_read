import type { UsageBucket } from "../utils/usage-tracker.js";
import type { UsageInput } from "../utils/usage-tracker.js";
import type { VerificationLevel } from "../review/verification-level.js";

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
  /** Which verification level was actually reached for this page. */
  verificationLevel?: VerificationLevel;
  phases: {
    evidence: PhaseMetric;
    outline: PhaseMetric;
    draft: PhaseMetric;
    review: PhaseMetric;
    validate: PhaseMetric;
  };
  usage: UsageBucket;
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
  /** Mechanism coverage audit for this page. Undefined when
   *  coverageEnforcement was "off" at generation time. */
  coverage?: {
    /** Total mechanisms derived from the evidence ledger for this page. */
    totalMechanisms: number;
    /** Number of mechanisms the outline planner declared out-of-scope. */
    outOfScopeMechanisms: number;
    /** Mechanisms still missing from the draft when the page was finalized. */
    unresolvedMissingCoverage: number;
    /** Number of revisions triggered exclusively by coverage gaps
     *  (not by missing_evidence / factual_risks / scope_violations). */
    coverageDrivenRevisions: number;
  };
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
  prefetchHitRate: number;
  orphanedPrefetch?: {
    phases: {
      evidence?: PhaseMetric;
      outline?: PhaseMetric;
    };
  };
  /** Job-wide mechanism coverage summary. Undefined when no page used
   *  coverage enforcement. */
  coverageAudit?: {
    /** Sum of totalMechanisms across all pages. */
    totalMechanismsJob: number;
    /** Sum of unresolvedMissingCoverage across all pages. */
    unresolvedJob: number;
    /** Slugs of pages that ended with non-zero unresolvedMissingCoverage. */
    pagesWithCoverageGap: string[];
  };
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
  private orphanedPrefetch: ThroughputReport["orphanedPrefetch"];

  setCatalog(metric: PhaseMetric): void {
    // Preserve a seeded catalog metric (from a prior session loaded via
    // `seed`) when the current session's catalog phase did no LLM work.
    // On resume, runCatalogPhase reads wiki.json from disk — llmCalls=0.
    // Without this guard we'd erase the original run's catalog cost and
    // under-report the job total.
    if (this.catalog.llmCalls > 0 && metric.llmCalls === 0) return;
    this.catalog = metric;
  }

  addPage(record: PageThroughputRecord): void {
    // Replace any prior record for the same slug so a page re-run during
    // resume overwrites the seeded/partial version. First-session pages
    // that aren't re-run stay intact.
    const existingIdx = this.pageRecords.findIndex(p => p.pageSlug === record.pageSlug);
    if (existingIdx >= 0) {
      this.pageRecords[existingIdx] = record;
    } else {
      this.pageRecords.push(record);
    }
  }

  setOrphanedPrefetch(value: ThroughputReport["orphanedPrefetch"]): void {
    this.orphanedPrefetch = value;
  }

  /**
   * Hydrate from a previously-persisted report. Used on resume so pages
   * processed in an earlier session (possibly killed by reboot/crash) are
   * carried forward into the current builder's state.
   *
   * Dedups by pageSlug: if the same page appears in the loaded report AND is
   * added later in this session, only the later record is kept in the final
   * output. This matters because a resume may re-run a page that was
   * mid-draft when the previous session died.
   */
  seed(report: ThroughputReport): void {
    this.catalog = report.catalog;
    this.pageRecords.length = 0;
    this.pageRecords.push(...report.pages);
    // Only seed orphanedPrefetch when the prior report actually captured one.
    // Otherwise we'd overwrite any orphanedPrefetch the current session may
    // discover during the initial catalog window with `undefined`.
    if (report.orphanedPrefetch !== undefined) {
      this.orphanedPrefetch = report.orphanedPrefetch;
    }
  }

  /**
   * Like `finish` but non-destructive — safe to call repeatedly after each
   * page completes for incremental throughput.json flushes. On reboot or
   * crash mid-job, whatever pages completed before the interruption remain
   * on disk instead of being lost.
   */
  snapshot(opts: { totalLatencyMs: number }): ThroughputReport {
    return this.finish(opts);
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
      // Only iterates page.phases — NOT page.prefetch.phases — so prefetch
      // diagnostic data is never double-counted in the totals.
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

    const prefetchedPages = this.pageRecords.filter(p => p.prefetch != null);
    const prefetchHits = prefetchedPages.filter(p => p.prefetch!.hit).length;
    const prefetchHitRate = prefetchedPages.length > 0 ? prefetchHits / prefetchedPages.length : 0;

    // Job-wide coverage audit: only emitted when at least one page
    // contributed a `coverage` record (i.e. coverageEnforcement != "off").
    let coverageAudit: ThroughputReport["coverageAudit"] | undefined;
    const pagesWithCoverage = this.pageRecords.filter((p) => p.coverage != null);
    if (pagesWithCoverage.length > 0) {
      let totalMechanismsJob = 0;
      let unresolvedJob = 0;
      const pagesWithGap: string[] = [];
      for (const p of pagesWithCoverage) {
        const c = p.coverage!;
        totalMechanismsJob += c.totalMechanisms;
        unresolvedJob += c.unresolvedMissingCoverage;
        if (c.unresolvedMissingCoverage > 0) pagesWithGap.push(p.pageSlug);
      }
      coverageAudit = {
        totalMechanismsJob,
        unresolvedJob,
        pagesWithCoverageGap: pagesWithGap,
      };
    }

    return {
      catalog: this.catalog,
      pages: this.pageRecords,
      totals: {
        llmCalls: totalLlmCalls,
        totalLatencyMs: opts.totalLatencyMs,
        usage: totalUsage,
      },
      reviewEscalationRate,
      prefetchHitRate,
      ...(this.orphanedPrefetch ? { orphanedPrefetch: this.orphanedPrefetch } : {}),
      ...(coverageAudit ? { coverageAudit } : {}),
    };
  }
}
