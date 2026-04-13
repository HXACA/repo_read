import type { LanguageModel } from "ai";
import type { CitationRecord } from "../types/generation.js";
import type { MainAuthorContext } from "../types/agent.js";
import type { UsageInput } from "../utils/usage-tracker.js";
import { ForkWorker } from "./fork-worker.js";
import {
  EvidencePlanner,
  fallbackPlan,
  type EvidencePlan,
  type EvidencePlanInput,
  type EvidenceTask,
} from "./evidence-planner.js";
import { zeroUsage, addUsage, addUsageInput } from "./throughput-metrics.js";
import type { ProviderCallOptions } from "../runtime/turn-types.js";

export type EvidenceCoordinatorOptions = {
  plannerModel: LanguageModel;
  workerModel: LanguageModel;
  repoRoot: string;
  concurrency: number;
  workerMaxSteps?: number;
  allowBash?: boolean;
  providerCallOptions?: ProviderCallOptions;
  onWorkerStep?: (step: import("../agent/agent-loop.js").StepInfo) => void;
};

export type CollectInput = {
  pageTitle: string;
  pageRationale: string;
  pageOrder: number;
  coveredFiles: string[];
  publishedSummaries: Array<{ slug: string; title: string; summary: string }>;
  taskCount: number;
  language: string;
  /** Free-form context passed down to each worker (e.g. page plan). */
  workerContext: string;
  /** Existing evidence from previous collection — new results merge into this */
  existingLedger?: Array<{ id: string; kind: string; target: string; note: string }>;
  /** Areas the reviewer flagged as needing more evidence */
  focusAreas?: string[];
};

export type EvidenceCollectionResult = {
  ledger: MainAuthorContext["evidence_ledger"];
  findings: string[];
  openQuestions: string[];
  plan: EvidencePlan;
  failedTaskIds: string[];
  usedFallback: boolean;
  metrics: { llmCalls: number; usage: UsageInput };
};

/**
 * Orchestrates parallel `worker` subtasks for a single page's evidence
 * collection. The flow is:
 *
 *   1. Ask the planner (drafter LLM) to split work into N tasks.
 *      On planner failure → deterministic fallback to even file-count split.
 *   2. Run all tasks in parallel, bounded by `concurrency`.
 *      On individual worker failure → retry once, then skip that task.
 *   3. Merge all `ForkWorkerResult` outputs into a deduplicated
 *      evidence_ledger, flattened findings, and flattened open questions.
 *
 * The coordinator is deliberately tolerant: one or two failing workers
 * should NOT block page generation. The drafter still runs with whatever
 * evidence was successfully collected.
 */
export class EvidenceCoordinator {
  private readonly planner: EvidencePlanner;
  private readonly workerFactory: () => ForkWorker;
  private readonly concurrency: number;

  constructor(options: EvidenceCoordinatorOptions) {
    this.planner = new EvidencePlanner({ model: options.plannerModel, providerCallOptions: options.providerCallOptions });
    this.workerFactory = () =>
      new ForkWorker({
        model: options.workerModel,
        repoRoot: options.repoRoot,
        maxSteps: options.workerMaxSteps,
        allowBash: options.allowBash,
        providerCallOptions: options.providerCallOptions,
        onStep: options.onWorkerStep,
      });
    this.concurrency = Math.max(1, options.concurrency);
  }

  async collect(input: CollectInput): Promise<EvidenceCollectionResult> {
    // Step 1: Plan
    const planInput: EvidencePlanInput = {
      pageTitle: input.pageTitle,
      pageRationale: input.pageRationale,
      coveredFiles: input.coveredFiles,
      pageOrder: input.pageOrder,
      publishedSummaries: input.publishedSummaries,
      taskCount: input.taskCount,
      language: input.language,
    };

    const planResult = await this.planner.plan(planInput);
    let plan: EvidencePlan;
    let usedFallback = false;
    if (planResult.success) {
      plan = planResult.plan;
    } else {
      plan = fallbackPlan(planInput);
      usedFallback = true;
    }

    // Step 2: Execute workers in parallel, bounded by concurrency
    // Append focus areas to worker context when provided (retry with reviewer feedback)
    let workerContext = input.workerContext;
    if (input.focusAreas?.length) {
      workerContext += `\nFocus areas for additional evidence: ${input.focusAreas.join(", ")}`;
    }
    const results = await this.runWorkersBounded(plan.tasks, workerContext);

    // Step 3: Merge
    const ledgerMap = new Map<string, MainAuthorContext["evidence_ledger"][number]>();
    const findings: string[] = [];
    const openQuestions: string[] = [];
    const failedTaskIds: string[] = [];

    // Seed with existing ledger when doing incremental re-collection
    if (input.existingLedger?.length) {
      for (const entry of input.existingLedger) {
        const key = `${entry.kind}:${entry.target}`;
        ledgerMap.set(key, entry as MainAuthorContext["evidence_ledger"][number]);
      }
    }

    let ledgerAutoId = ledgerMap.size + 1;

    for (const r of results) {
      if (r.status === "failed") {
        failedTaskIds.push(r.taskId);
        continue;
      }
      for (const finding of r.data.findings) {
        if (finding.trim()) findings.push(finding.trim());
      }
      for (const q of r.data.open_questions ?? []) {
        if (q.trim()) openQuestions.push(q.trim());
      }
      for (const c of r.data.citations) {
        const entry = toLedgerEntry(c, String(ledgerAutoId));
        // Deduplicate by target (which already includes locator via toLedgerEntry)
        const key = `${entry.kind}:${entry.target}`;
        if (!ledgerMap.has(key)) {
          ledgerMap.set(key, entry);
          ledgerAutoId++;
        }
      }
    }

    // Aggregate metrics from planner + workers
    const aggregatedUsage = zeroUsage();
    let totalLlmCalls = 0;
    // Include planner's own metrics when available (tracks actual LLM usage).
    // Falls back to the legacy heuristic (1 call when plan has >1 tasks) for
    // planners that don't yet return metrics.
    if (planResult.metrics) {
      addUsageInput(aggregatedUsage, planResult.metrics.usage);
      totalLlmCalls += planResult.metrics.llmCalls;
    } else if (planResult.success && plan.tasks.length > 1) {
      totalLlmCalls += 1;
    }
    for (const r of results) {
      if (r.status === "ok" && r.metrics) {
        addUsage(aggregatedUsage, {
          ...r.metrics.usage,
          requests: r.metrics.llmCalls,
        });
        totalLlmCalls += r.metrics.llmCalls;
      }
    }

    return {
      ledger: Array.from(ledgerMap.values()),
      findings,
      openQuestions,
      plan,
      failedTaskIds,
      usedFallback,
      metrics: {
        llmCalls: totalLlmCalls,
        usage: {
          inputTokens: aggregatedUsage.inputTokens,
          outputTokens: aggregatedUsage.outputTokens,
          reasoningTokens: aggregatedUsage.reasoningTokens,
          cachedTokens: aggregatedUsage.cachedTokens,
        },
      },
    };
  }

  /**
   * Runs a list of tasks with bounded concurrency. Each task is attempted
   * twice (original + 1 retry) before being marked failed.
   */
  private async runWorkersBounded(
    tasks: EvidenceTask[],
    workerContext: string,
  ): Promise<WorkerOutcome[]> {
    const outcomes: WorkerOutcome[] = new Array(tasks.length);
    let nextIndex = 0;

    const runOne = async () => {
      while (true) {
        const i = nextIndex++;
        if (i >= tasks.length) return;
        outcomes[i] = await this.runWithRetry(tasks[i], workerContext);
      }
    };

    const workers = Array.from(
      { length: Math.min(this.concurrency, tasks.length) },
      () => runOne(),
    );
    await Promise.all(workers);
    return outcomes;
  }

  private async runWithRetry(
    task: EvidenceTask,
    workerContext: string,
  ): Promise<WorkerOutcome> {
    const worker = this.workerFactory();
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const result = await worker.execute({
          directive: task.directive,
          context: workerContext,
          relevantFiles: task.targetFiles,
        });
        if (result.success && result.data) {
          return { status: "ok", taskId: task.id, data: result.data, metrics: result.metrics };
        }
        // success=false: fall through to retry
      } catch {
        // exception: fall through to retry
      }
    }
    return { status: "failed", taskId: task.id };
  }
}

type WorkerOutcome =
  | {
      status: "ok";
      taskId: string;
      data: { findings: string[]; citations: CitationRecord[]; open_questions: string[] };
      metrics?: { llmCalls: number; usage: UsageInput };
    }
  | { status: "failed"; taskId: string };

function toLedgerEntry(
  citation: CitationRecord,
  id: string,
): MainAuthorContext["evidence_ledger"][number] {
  return {
    id,
    kind: citation.kind,
    target: citation.locator
      ? `${citation.target}:${citation.locator}`
      : citation.target,
    note: citation.note ?? "",
  };
}
