import { describe, it, expect, beforeEach } from "vitest";
import {
  ThroughputMetricsCollector,
  ThroughputReportBuilder,
  zeroUsage,
  cloneUsage,
  addUsage,
  addUsageInput,
  type PageThroughputRecord,
  type PhaseMetric,
  type ThroughputReport,
} from "../throughput-metrics.js";
import type { UsageBucket } from "../../utils/usage-tracker.js";

function makeUsage(overrides: Partial<UsageBucket> = {}): UsageBucket {
  return {
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cachedTokens: 0,
    requests: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helper tests
// ---------------------------------------------------------------------------

describe("zeroUsage", () => {
  it("returns a bucket with all zeroes", () => {
    const u = zeroUsage();
    expect(u.inputTokens).toBe(0);
    expect(u.outputTokens).toBe(0);
    expect(u.reasoningTokens).toBe(0);
    expect(u.cachedTokens).toBe(0);
    expect(u.requests).toBe(0);
  });
});

describe("cloneUsage", () => {
  it("returns a shallow copy with the same values", () => {
    const original = makeUsage({ inputTokens: 10, outputTokens: 20, requests: 2 });
    const clone = cloneUsage(original);
    expect(clone).toEqual(original);
    expect(clone).not.toBe(original);
  });
});

describe("addUsage", () => {
  it("accumulates all fields from source into target", () => {
    const target = makeUsage({ inputTokens: 5, requests: 1 });
    const source = makeUsage({ inputTokens: 10, outputTokens: 15, reasoningTokens: 3, cachedTokens: 2, requests: 2 });
    addUsage(target, source);
    expect(target.inputTokens).toBe(15);
    expect(target.outputTokens).toBe(15);
    expect(target.reasoningTokens).toBe(3);
    expect(target.cachedTokens).toBe(2);
    expect(target.requests).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// ThroughputMetricsCollector
// ---------------------------------------------------------------------------

describe("ThroughputMetricsCollector", () => {
  let collector: ThroughputMetricsCollector;

  beforeEach(() => {
    collector = new ThroughputMetricsCollector();
  });

  it("finish returns zero pages when nothing was tracked", () => {
    const result = collector.finish("job-1", "my-proj");
    expect(result.jobId).toBe("job-1");
    expect(result.projectSlug).toBe("my-proj");
    expect(result.totalPages).toBe(0);
    expect(result.pages).toHaveLength(0);
    expect(result.totalUsage).toEqual(zeroUsage());
  });

  it("setCatalog sets totalPages on the report", () => {
    collector.setCatalog(7);
    const result = collector.finish("job-2", "proj");
    expect(result.totalPages).toBe(7);
  });

  it("addPage + finishPage records a page with correct lane and duration", () => {
    collector.addPage("overview", "standard");
    collector.finishPage("overview");

    const result = collector.finish("job-3", "proj");
    expect(result.pages).toHaveLength(1);

    const page = result.pages[0];
    expect(page.pageSlug).toBe("overview");
    expect(page.lane).toBe("standard");
    expect(page.durationMs).toBeGreaterThanOrEqual(0);
    expect(page.startedAt).toBeTruthy();
    expect(page.finishedAt).toBeTruthy();
  });

  it("recordStage stores stage metrics and they contribute to totalUsage", () => {
    collector.addPage("intro", "fast");
    collector.recordStage("intro", "draft", 500, makeUsage({ inputTokens: 100, outputTokens: 50, requests: 1 }));
    collector.recordStage("intro", "review", 200, makeUsage({ inputTokens: 30, outputTokens: 10, requests: 1 }));
    collector.finishPage("intro");

    const result = collector.finish("job-4", "proj");
    const page = result.pages[0];

    expect(page.stages.draft?.durationMs).toBe(500);
    expect(page.stages.draft?.usage.inputTokens).toBe(100);
    expect(page.stages.review?.durationMs).toBe(200);

    expect(page.totalUsage.inputTokens).toBe(130);
    expect(page.totalUsage.outputTokens).toBe(60);
    expect(page.totalUsage.requests).toBe(2);
  });

  it("byLane aggregates correctly across multiple pages", () => {
    collector.addPage("p1", "fast");
    collector.recordStage("p1", "draft", 100, makeUsage({ inputTokens: 10, requests: 1 }));
    collector.finishPage("p1");

    collector.addPage("p2", "fast");
    collector.recordStage("p2", "draft", 200, makeUsage({ inputTokens: 20, requests: 1 }));
    collector.finishPage("p2");

    collector.addPage("p3", "deep");
    collector.recordStage("p3", "draft", 1000, makeUsage({ inputTokens: 500, requests: 1 }));
    collector.finishPage("p3");

    const result = collector.finish("job-5", "proj");

    expect(result.byLane.fast.count).toBe(2);
    expect(result.byLane.fast.totalUsage.inputTokens).toBe(30);
    expect(result.byLane.deep.count).toBe(1);
    expect(result.byLane.deep.totalUsage.inputTokens).toBe(500);
    expect(result.byLane.standard.count).toBe(0);
  });

  it("totalUsage on the job sums all pages", () => {
    collector.addPage("a", "standard");
    collector.recordStage("a", "evidence", 300, makeUsage({ inputTokens: 200, outputTokens: 100, requests: 2 }));
    collector.finishPage("a");

    collector.addPage("b", "standard");
    collector.recordStage("b", "evidence", 300, makeUsage({ inputTokens: 50, outputTokens: 25, requests: 1 }));
    collector.finishPage("b");

    const result = collector.finish("job-6", "proj");
    expect(result.totalUsage.inputTokens).toBe(250);
    expect(result.totalUsage.outputTokens).toBe(125);
    expect(result.totalUsage.requests).toBe(3);
  });

  it("finishPage on unknown slug is a no-op", () => {
    collector.finishPage("nonexistent");
    const result = collector.finish("job-7", "proj");
    expect(result.pages).toHaveLength(0);
  });

  it("recordStage on unknown slug is a no-op", () => {
    collector.recordStage("ghost", "draft", 100, makeUsage({ requests: 1 }));
    const result = collector.finish("job-8", "proj");
    expect(result.pages).toHaveLength(0);
  });

  it("durationMs on job is non-negative", () => {
    const result = collector.finish("job-9", "proj");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// PhaseMetric — reused flag flip
// ---------------------------------------------------------------------------

describe("PhaseMetric reused flip", () => {
  it("reused flips to false when evidence is recollected after cache load", () => {
    // Simulate: evidence was loaded from disk on first attempt
    // (pipeline sets reused: true, llmCalls: 0)
    const evidenceMetric: PhaseMetric = {
      llmCalls: 0,
      durationMs: 0,
      usage: { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cachedTokens: 0 },
      reused: true,
    };

    expect(evidenceMetric.reused).toBe(true);

    // Simulate: shouldCollectEvidence fires on a retry (reviewer flagged
    // missing_evidence), so the coordinator runs and returns real LLM metrics.
    const freshMetrics = {
      llmCalls: 2,
      usage: { inputTokens: 150, outputTokens: 75, reasoningTokens: 0, cachedTokens: 0 },
    };

    // Apply what the pipeline does when evidence is re-collected
    evidenceMetric.llmCalls += freshMetrics.llmCalls;
    addUsageInput(evidenceMetric.usage, freshMetrics.usage);
    if (freshMetrics.llmCalls > 0) evidenceMetric.reused = false;

    // reused must now be false because real LLM calls were made
    expect(evidenceMetric.reused).toBe(false);
    expect(evidenceMetric.llmCalls).toBe(2);
    expect(evidenceMetric.usage.inputTokens).toBe(150);
  });
});

// ---------------------------------------------------------------------------
// ThroughputReportBuilder — seed / snapshot / dedup (incremental-save path)
// ---------------------------------------------------------------------------

function makePageRecord(slug: string, input = 100): PageThroughputRecord {
  return {
    pageSlug: slug,
    lane: "standard",
    totalLatencyMs: 1000,
    revisionAttempts: 0,
    escalatedToDeepLane: false,
    verificationLevel: "L1",
    phases: {
      evidence: { llmCalls: 1, durationMs: 500, usage: { inputTokens: input, outputTokens: 10, reasoningTokens: 0, cachedTokens: 0 }, reused: false },
      outline:  { llmCalls: 1, durationMs: 100, usage: { inputTokens: 0,     outputTokens: 0,  reasoningTokens: 0, cachedTokens: 0 }, reused: false },
      draft:    { llmCalls: 1, durationMs: 400, usage: { inputTokens: 0,     outputTokens: 0,  reasoningTokens: 0, cachedTokens: 0 } },
      review:   { llmCalls: 0, durationMs: 0,   usage: { inputTokens: 0,     outputTokens: 0,  reasoningTokens: 0, cachedTokens: 0 } },
      validate: { llmCalls: 0, durationMs: 0,   usage: { inputTokens: 0,     outputTokens: 0,  reasoningTokens: 0, cachedTokens: 0 } },
    },
    usage: { inputTokens: input, outputTokens: 10, reasoningTokens: 0, cachedTokens: 0, requests: 3 },
  } as PageThroughputRecord;
}

describe("ThroughputReportBuilder seed + incremental", () => {
  it("seed hydrates catalog + pages from a prior report", () => {
    const builder = new ThroughputReportBuilder();
    const prior: ThroughputReport = {
      catalog: { llmCalls: 2, durationMs: 2000, usage: { inputTokens: 500, outputTokens: 50, reasoningTokens: 0, cachedTokens: 0 } },
      pages: [makePageRecord("a"), makePageRecord("b")],
      totals: { llmCalls: 2, totalLatencyMs: 2000, usage: { inputTokens: 500, outputTokens: 50, reasoningTokens: 0, cachedTokens: 0, requests: 2 } },
      reviewEscalationRate: 0,
      prefetchHitRate: 0,
    };
    builder.seed(prior);

    const snap = builder.snapshot({ totalLatencyMs: 3000 });
    expect(snap.pages.map(p => p.pageSlug)).toEqual(["a", "b"]);
    expect(snap.catalog.llmCalls).toBe(2);
  });

  it("setCatalog preserves seeded catalog when current session has 0 llmCalls (resume case)", () => {
    // On resume, runCatalogPhase reads wiki.json from disk — no LLM calls.
    // Without the guard, setCatalog would erase the original run's catalog cost.
    const builder = new ThroughputReportBuilder();
    builder.seed({
      catalog: { llmCalls: 3, durationMs: 5000, usage: { inputTokens: 1000, outputTokens: 100, reasoningTokens: 0, cachedTokens: 0 } },
      pages: [],
      totals: { llmCalls: 3, totalLatencyMs: 5000, usage: { inputTokens: 1000, outputTokens: 100, reasoningTokens: 0, cachedTokens: 0, requests: 3 } },
      reviewEscalationRate: 0,
      prefetchHitRate: 0,
    });

    // Resume session: catalog "ran" but made no LLM calls
    builder.setCatalog({ llmCalls: 0, durationMs: 10, usage: zeroUsage(), reused: true });

    const snap = builder.snapshot({ totalLatencyMs: 1000 });
    expect(snap.catalog.llmCalls).toBe(3);
    expect(snap.catalog.usage.inputTokens).toBe(1000);
  });

  it("setCatalog overwrites when current session actually ran catalog LLM calls", () => {
    const builder = new ThroughputReportBuilder();
    builder.seed({
      catalog: { llmCalls: 2, durationMs: 2000, usage: { inputTokens: 500, outputTokens: 50, reasoningTokens: 0, cachedTokens: 0 } },
      pages: [],
      totals: { llmCalls: 2, totalLatencyMs: 2000, usage: { inputTokens: 500, outputTokens: 50, reasoningTokens: 0, cachedTokens: 0, requests: 2 } },
      reviewEscalationRate: 0,
      prefetchHitRate: 0,
    });

    // Fresh session: real catalog run
    builder.setCatalog({ llmCalls: 4, durationMs: 8000, usage: { inputTokens: 1500, outputTokens: 200, reasoningTokens: 0, cachedTokens: 0 }, reused: false });

    const snap = builder.snapshot({ totalLatencyMs: 1000 });
    expect(snap.catalog.llmCalls).toBe(4);
  });

  it("addPage dedups by slug — resumed page re-run overwrites seeded record", () => {
    const builder = new ThroughputReportBuilder();
    builder.seed({
      catalog: { llmCalls: 0, durationMs: 0, usage: zeroUsage() },
      pages: [makePageRecord("p1", 100), makePageRecord("p2", 200)],
      totals: { llmCalls: 0, totalLatencyMs: 0, usage: { ...zeroUsage(), requests: 0 } },
      reviewEscalationRate: 0,
      prefetchHitRate: 0,
    });

    // Resume re-runs p1 with a different input cost
    builder.addPage(makePageRecord("p1", 999));

    const snap = builder.snapshot({ totalLatencyMs: 1000 });
    expect(snap.pages).toHaveLength(2);
    const p1 = snap.pages.find(p => p.pageSlug === "p1")!;
    expect(p1.phases.evidence.usage.inputTokens).toBe(999);
  });

  it("snapshot can be called repeatedly without mutating builder state (incremental flush safe)", () => {
    const builder = new ThroughputReportBuilder();
    builder.addPage(makePageRecord("a"));

    const snap1 = builder.snapshot({ totalLatencyMs: 500 });
    const snap2 = builder.snapshot({ totalLatencyMs: 600 });

    expect(snap1.pages).toHaveLength(1);
    expect(snap2.pages).toHaveLength(1);
    // Adding more pages after a snapshot still works
    builder.addPage(makePageRecord("b"));
    const snap3 = builder.snapshot({ totalLatencyMs: 700 });
    expect(snap3.pages.map(p => p.pageSlug)).toEqual(["a", "b"]);
  });
});
