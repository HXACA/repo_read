import { describe, it, expect, vi, beforeEach } from "vitest";
import { startPrefetch, type PrefetchSlot } from "../page-prefetcher.js";

const mockCollect = vi.fn();
vi.mock("../evidence-coordinator.js", () => ({
  EvidenceCoordinator: vi.fn().mockImplementation(() => ({
    collect: mockCollect,
  })),
}));

const mockPlanWithMetrics = vi.fn();
vi.mock("../outline-planner.js", () => ({
  OutlinePlanner: vi.fn().mockImplementation(() => ({
    planWithMetrics: mockPlanWithMetrics,
  })),
}));

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
  publishedSummaries: [
    { slug: "prev", title: "Prev", summary: "Previous page" },
  ],
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
  metrics: {
    llmCalls: 2,
    usage: {
      inputTokens: 500,
      outputTokens: 100,
      reasoningTokens: 0,
      cachedTokens: 0,
    },
  },
};

const outlineResult = {
  outline: {
    sections: [
      { heading: "Section 1", key_points: ["point"], cite_from: [] },
    ],
  },
  usedFallback: false,
  metrics: {
    llmCalls: 1,
    usage: {
      inputTokens: 200,
      outputTokens: 50,
      reasoningTokens: 0,
      cachedTokens: 0,
    },
  },
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

  it("uses concurrency=1 for lightweight profile", async () => {
    mockCollect.mockResolvedValue(evidenceResult);
    mockPlanWithMetrics.mockResolvedValue(outlineResult);

    startPrefetch(basePage, baseContext);

    const { EvidenceCoordinator } = await import(
      "../evidence-coordinator.js"
    );
    const ctorCall = vi.mocked(EvidenceCoordinator).mock.calls[0][0];
    expect(ctorCall.concurrency).toBe(1);
  });

  it("uses snapshot of publishedSummaries (not shared reference)", async () => {
    mockCollect.mockResolvedValue(evidenceResult);
    mockPlanWithMetrics.mockResolvedValue(outlineResult);

    const mutableSummaries = [
      { slug: "prev", title: "Prev", summary: "Previous" },
    ];
    const ctx = { ...baseContext, publishedSummaries: mutableSummaries };

    const slot = startPrefetch(basePage, ctx);
    mutableSummaries.push({ slug: "new", title: "New", summary: "Added after" });

    await slot.promise;

    expect(mockCollect.mock.calls[0][0].publishedSummaries).toHaveLength(1);
  });
});
