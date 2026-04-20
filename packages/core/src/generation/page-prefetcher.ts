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
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { LanguageModel } from "ai";
import type { WikiJson } from "../types/generation.js";
import type { UsageInput } from "../utils/usage-tracker.js";
import type { PhaseMetric } from "./throughput-metrics.js";
import type { ProviderCallOptions } from "../runtime/turn-types.js";
import type { ArtifactStore } from "../artifacts/artifact-store.js";
import type { StepInfo } from "../agent/agent-loop.js";
import {
  EvidenceCoordinator,
  type EvidenceCollectionResult,
} from "./evidence-coordinator.js";
import { OutlinePlanner } from "./outline-planner.js";
import { deriveMechanismList, type Mechanism } from "./mechanism-list.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
  /** Quality profile coverage enforcement mode. When undefined or "off",
   *  prefetch does not derive a mechanism list (preserves legacy behavior). */
  qualityProfile?: {
    coverageEnforcement: "off" | "warn" | "strict";
    outOfScopeRatio?: number;
  };
};

type PageEntry = WikiJson["reading_order"][number];

// ---------------------------------------------------------------------------
// startPrefetch
// ---------------------------------------------------------------------------

/**
 * Kicks off background evidence + outline collection for a single page.
 * Returns a `PrefetchSlot` immediately — callers can await `slot.promise`
 * or poll `slot.status` / `slot.artifactsReady`.
 *
 * Uses a lightweight profile: concurrency=1, taskCount=1 to keep resource
 * usage low while the main pipeline is busy with review.
 *
 * The returned promise **never throws** — all errors are caught internally
 * and stored in `slot.error`.
 */
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

  // SNAPSHOT publishedSummaries — do not pass shared mutable reference
  const snapshotSummaries = [...ctx.publishedSummaries];
  const pageRef = {
    projectSlug: ctx.slug,
    jobId: ctx.jobId,
    pageSlug: page.slug,
  };

  const debugLog = (msg: string) => {
    if (process.env.REPOREAD_DEBUG) {
      const line = `[prefetch] page=${page.slug} ${msg}\n`;
      fs.appendFile(path.join(ctx.repoRoot, ".reporead", "pipeline-debug.log"), line).catch(() => {});
    }
  };

  slot.promise = (async () => {
    try {
      debugLog("started");
      // Lightweight evidence coordinator: concurrency=1, taskCount=1
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

      // Phase 1: Evidence — failure here means the whole prefetch fails
      const evidenceStart = Date.now();
      const evidenceResult: EvidenceCollectionResult = await coordinator.collect(
        {
          pageTitle: page.title,
          pageRationale: page.rationale,
          pageOrder: ctx.pageIndex + 1,
          coveredFiles: page.covered_files,
          publishedSummaries: snapshotSummaries,
          taskCount: 1,
          language: ctx.language,
          workerContext: [
            `Project: ${ctx.wiki.summary}`,
            `Page plan: ${page.rationale}`,
          ].join("\n"),
        },
      );

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
      debugLog(`evidence done llmCalls=${evidenceResult.metrics.llmCalls} durationMs=${slot.phases.evidence.durationMs}`);

      // Phase 2: Outline — failure here is non-fatal (partial readiness)
      const outlineStart = Date.now();
      try {
        // Derive mechanism list for outline allocation. Empty when
        // coverageEnforcement is "off" / undefined — legacy behavior.
        const mechanisms: Mechanism[] =
          ctx.qualityProfile?.coverageEnforcement &&
          ctx.qualityProfile.coverageEnforcement !== "off"
            ? deriveMechanismList(evidenceResult.ledger, page.covered_files)
            : [];

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
          mechanisms,
          outOfScopeRatio: ctx.qualityProfile?.outOfScopeRatio,
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
      } catch (outlineErr) {
        debugLog(`outline failed: ${(outlineErr as Error).message}`);
        // Outline failed — artifactsReady.outline stays false, non-fatal
      }

      slot.status = "done";
      debugLog(`done evidence=${slot.artifactsReady.evidence} outline=${slot.artifactsReady.outline}`);
    } catch (err) {
      slot.status = "failed";
      debugLog(`failed: ${(err as Error).message}`);
      slot.error = (err as Error).message;
    }
  })();

  return slot;
}
