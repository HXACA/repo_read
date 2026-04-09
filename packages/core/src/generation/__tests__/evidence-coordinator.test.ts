import { describe, it, expect, vi, beforeEach } from "vitest";
import { EvidenceCoordinator } from "../evidence-coordinator.js";
import type { CollectInput } from "../evidence-coordinator.js";

// Mock ForkWorker so we can control success/failure and observe call order
const mockExecute = vi.fn();
vi.mock("../fork-worker.js", () => ({
  ForkWorker: vi.fn().mockImplementation(() => ({
    execute: mockExecute,
  })),
}));

// Mock EvidencePlanner: return a canned plan by default
const mockPlan = vi.fn();
vi.mock("../evidence-planner.js", async () => {
  const actual = await vi.importActual<typeof import("../evidence-planner.js")>(
    "../evidence-planner.js",
  );
  return {
    ...actual,
    EvidencePlanner: vi.fn().mockImplementation(() => ({
      plan: mockPlan,
    })),
  };
});

const baseInput: CollectInput = {
  pageTitle: "Overview",
  pageRationale: "Start here",
  pageOrder: 1,
  coveredFiles: ["a.ts", "b.ts", "c.ts"],
  publishedSummaries: [],
  taskCount: 3,
  language: "zh",
  workerContext: "ctx",
};

function workerOk(id: string) {
  return {
    success: true,
    data: {
      directive: `d${id}`,
      findings: [`f-${id}`],
      citations: [
        { kind: "file", target: `${id}.ts`, locator: "1-10", note: `n-${id}` },
      ],
      open_questions: [],
    },
  };
}

describe("EvidenceCoordinator", () => {
  beforeEach(() => {
    mockExecute.mockReset();
    mockPlan.mockReset();
  });

  it("uses planner output and runs workers in parallel", async () => {
    mockPlan.mockResolvedValueOnce({
      success: true,
      plan: {
        tasks: [
          { id: "t1", directive: "d1", targetFiles: ["a.ts"], rationale: "r1" },
          { id: "t2", directive: "d2", targetFiles: ["b.ts"], rationale: "r2" },
          { id: "t3", directive: "d3", targetFiles: ["c.ts"], rationale: "r3" },
        ],
      },
    });
    mockExecute
      .mockResolvedValueOnce(workerOk("t1"))
      .mockResolvedValueOnce(workerOk("t2"))
      .mockResolvedValueOnce(workerOk("t3"));

    const coordinator = new EvidenceCoordinator({
      plannerModel: {} as never,
      workerModel: {} as never,
      repoRoot: "/tmp",
      concurrency: 3,
    });

    const result = await coordinator.collect(baseInput);

    expect(result.plan.tasks).toHaveLength(3);
    expect(result.ledger).toHaveLength(3);
    expect(result.findings).toHaveLength(3);
    expect(result.failedTaskIds).toHaveLength(0);
    expect(result.usedFallback).toBe(false);
  });

  it("falls back to deterministic plan when planner fails", async () => {
    mockPlan.mockResolvedValueOnce({
      success: false,
      error: "planner LLM crashed",
    });
    mockExecute.mockImplementation(() =>
      Promise.resolve(workerOk("fallback")),
    );

    const coordinator = new EvidenceCoordinator({
      plannerModel: {} as never,
      workerModel: {} as never,
      repoRoot: "/tmp",
      concurrency: 3,
    });

    const result = await coordinator.collect(baseInput);

    expect(result.usedFallback).toBe(true);
    expect(result.plan.tasks.length).toBeGreaterThan(0);
    expect(result.failedTaskIds).toHaveLength(0);
  });

  it("retries a worker once then succeeds", async () => {
    mockPlan.mockResolvedValueOnce({
      success: true,
      plan: {
        tasks: [
          { id: "t1", directive: "d1", targetFiles: ["a.ts"], rationale: "r1" },
        ],
      },
    });
    // First call fails, second succeeds
    mockExecute
      .mockResolvedValueOnce({ success: false, error: "transient" })
      .mockResolvedValueOnce(workerOk("t1"));

    const coordinator = new EvidenceCoordinator({
      plannerModel: {} as never,
      workerModel: {} as never,
      repoRoot: "/tmp",
      concurrency: 1,
    });

    const result = await coordinator.collect({ ...baseInput, taskCount: 1 });

    expect(result.ledger.length).toBeGreaterThan(0);
    expect(result.failedTaskIds).toHaveLength(0);
    // Worker should have been called twice (original + retry)
    expect(mockExecute).toHaveBeenCalledTimes(2);
  });

  it("gives up after two failures and records the taskId", async () => {
    mockPlan.mockResolvedValueOnce({
      success: true,
      plan: {
        tasks: [
          { id: "t1", directive: "d1", targetFiles: ["a.ts"], rationale: "r1" },
          { id: "t2", directive: "d2", targetFiles: ["b.ts"], rationale: "r2" },
        ],
      },
    });
    // t1 always fails; t2 always succeeds
    mockExecute.mockImplementation((input: { directive: string }) => {
      if (input.directive === "d1") {
        return Promise.resolve({ success: false, error: "boom" });
      }
      return Promise.resolve(workerOk("t2"));
    });

    const coordinator = new EvidenceCoordinator({
      plannerModel: {} as never,
      workerModel: {} as never,
      repoRoot: "/tmp",
      concurrency: 2,
    });

    const result = await coordinator.collect({ ...baseInput, taskCount: 2 });

    expect(result.failedTaskIds).toEqual(["t1"]);
    // t2's result should still be in the ledger
    expect(result.ledger.length).toBeGreaterThan(0);
    expect(result.findings).toContain("f-t2");
  });

  it("dedups citations across workers", async () => {
    mockPlan.mockResolvedValueOnce({
      success: true,
      plan: {
        tasks: [
          { id: "t1", directive: "d1", targetFiles: ["a.ts"], rationale: "r1" },
          { id: "t2", directive: "d2", targetFiles: ["b.ts"], rationale: "r2" },
        ],
      },
    });
    const dup = {
      kind: "file" as const,
      target: "shared.ts",
      locator: "1-5",
      note: "dup",
    };
    mockExecute
      .mockResolvedValueOnce({
        success: true,
        data: {
          directive: "d1",
          findings: ["f1"],
          citations: [dup],
          open_questions: [],
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          directive: "d2",
          findings: ["f2"],
          citations: [dup],
          open_questions: [],
        },
      });

    const coordinator = new EvidenceCoordinator({
      plannerModel: {} as never,
      workerModel: {} as never,
      repoRoot: "/tmp",
      concurrency: 2,
    });

    const result = await coordinator.collect({ ...baseInput, taskCount: 2 });

    // Only one dedup'd ledger entry for the shared citation
    expect(result.ledger).toHaveLength(1);
    // Both findings preserved
    expect(result.findings).toEqual(expect.arrayContaining(["f1", "f2"]));
  });

  it("bounds parallel worker executions by concurrency", async () => {
    mockPlan.mockResolvedValueOnce({
      success: true,
      plan: {
        tasks: Array.from({ length: 6 }, (_, i) => ({
          id: `t${i + 1}`,
          directive: `d${i + 1}`,
          targetFiles: [`f${i + 1}.ts`],
          rationale: "r",
        })),
      },
    });

    let inFlight = 0;
    let maxInFlight = 0;
    mockExecute.mockImplementation(async (input: { directive: string }) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 20));
      inFlight--;
      return workerOk(input.directive);
    });

    const coordinator = new EvidenceCoordinator({
      plannerModel: {} as never,
      workerModel: {} as never,
      repoRoot: "/tmp",
      concurrency: 2,
    });

    await coordinator.collect({
      ...baseInput,
      coveredFiles: ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts", "f.ts"],
      taskCount: 6,
    });

    expect(maxInFlight).toBeLessThanOrEqual(2);
  });
});
