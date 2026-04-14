import { describe, it, expect } from "vitest";
import {
  ThroughputReportBuilder,
  zeroPhaseMetric,
  type PageThroughputRecord,
  type PhaseMetric,
} from "../throughput-metrics.js";

function makePageRecord(overrides: Partial<PageThroughputRecord> = {}): PageThroughputRecord {
  const zp: PhaseMetric = zeroPhaseMetric();
  return {
    pageSlug: "test-page",
    lane: "standard",
    totalLatencyMs: 1000,
    revisionAttempts: 0,
    escalatedToDeepLane: false,
    phases: {
      evidence: { ...zp, llmCalls: 2, usage: { inputTokens: 500, outputTokens: 100, reasoningTokens: 0, cachedTokens: 0 } },
      outline: { ...zp, llmCalls: 1, usage: { inputTokens: 200, outputTokens: 50, reasoningTokens: 0, cachedTokens: 0 } },
      draft: { ...zp, llmCalls: 1, usage: { inputTokens: 1000, outputTokens: 500, reasoningTokens: 0, cachedTokens: 0 } },
      review: zp,
      validate: zp,
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
    builder.addPage(makePageRecord({ pageSlug: "p1", prefetch: { hit: true, waitMs: 0, phases: {} } }));
    builder.addPage(makePageRecord({ pageSlug: "p2", prefetch: { hit: false, waitMs: 100, phases: {} } }));
    builder.addPage(makePageRecord({ pageSlug: "p3" })); // no prefetch
    const report = builder.finish({ totalLatencyMs: 10000 });
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
