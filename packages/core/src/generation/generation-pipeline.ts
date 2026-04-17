import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { LanguageModel } from "ai";
import type { StorageAdapter } from "../storage/storage-adapter.js";
import type { GenerationJob, WikiJson, PageMeta } from "../types/generation.js";
import type { ResolvedConfig } from "../types/config.js";
import type { MainAuthorContext } from "../types/agent.js";
import type { ReviewBriefing } from "../types/review.js";
import type { RepoProfile } from "../types/project.js";
import { JobStateManager } from "./job-state.js";
import { JobEventEmitter } from "./generation-events.js";
import { profileRepo } from "../project/repo-profiler.js";
import { PageDrafter } from "./page-drafter.js";
import { VerificationLadder, type LadderResult } from "../review/verification-ladder.js";
import { selectVerificationLevel, type VerificationLevel } from "../review/verification-level.js";
import { validatePage } from "../validation/page-validator.js";
import { validateCatalog } from "../catalog/catalog-validator.js";
import { CatalogPlanner } from "../catalog/catalog-planner.js";
import { persistCatalog } from "../catalog/catalog-persister.js";
import { Publisher } from "./publisher.js";
import { EvidenceCoordinator, type EvidenceCollectionResult } from "./evidence-coordinator.js";
import { OutlinePlanner } from "./outline-planner.js";
import { deriveMechanismList, type Mechanism } from "./mechanism-list.js";
import type { PageOutline } from "../types/agent.js";
import { ArtifactStore } from "../artifacts/artifact-store.js";
import {
  ThroughputReportBuilder,
  zeroPhaseMetric,
  zeroUsage as zeroThroughputUsage,
  addUsageInput,
  type PhaseMetric,
  type PageThroughputRecord,
} from "./throughput-metrics.js";
import type { PageRef, VersionedPageRef } from "../artifacts/types.js";
import { computeComplexity } from "./complexity-scorer.js";
import { selectExecutionLane } from "./execution-lane.js";
import type { ProviderCallOptions } from "../runtime/turn-types.js";
import { getModelOptionsForRole, type ModelOptions } from "../providers/model-factory.js";
import { UsageTracker } from "../utils/usage-tracker.js";
import { startPrefetch, type PrefetchSlot } from "./page-prefetcher.js";
import { ParallelPageScheduler } from "./parallel-scheduler.js";

export type GenerationPipelineOptions = {
  storage: StorageAdapter;
  jobManager: JobStateManager;
  config: ResolvedConfig;
  catalogModel: LanguageModel;
  outlineModel: LanguageModel;
  drafterModel: LanguageModel;
  workerModel: LanguageModel;
  reviewerModel: LanguageModel;
  repoRoot: string;
  commitHash: string;
  usageTracker?: UsageTracker;
};

export type PipelineResult = {
  success: boolean;
  job: GenerationJob;
  error?: string;
  usageTracker?: UsageTracker;
};

/**
 * Optional per-run configuration for `GenerationPipeline.run()`.
 *
 * When `resumeWith` is set, the pipeline:
 *  - skips the entire catalog phase and uses the provided wiki directly
 *    (avoiding another LLM call and preserving the original reading order)
 *  - skips any page whose slug is in `skipPageSlugs`
 *  - rebuilds `publishedSummaries` / `knownPages` from the existing page
 *    meta files so later pages can still reference the skipped ones via
 *    `[cite:page:slug]`
 *  - transitions through states as normal, starting from `page_drafting`
 */
export type PipelineRunOptions = {
  resumeWith?: {
    wiki: WikiJson;
    skipPageSlugs: Set<string>;
  };
  /** Real-time event callback for CLI progress display. */
  onEvent?: (event: import("../types/events.js").AppEvent) => void;
  /**
   * Pre-computed repo profile.  When supplied the pipeline skips its own
   * `profileRepo()` call, avoiding a duplicate filesystem walk.
   */
  repoProfile?: RepoProfile;
};

/** Build request-scoped provider call options from role model options + job cache key. */
function buildProviderOpts(roleOptions: ModelOptions, cacheKey: string): ProviderCallOptions {
  return {
    cacheKey,
    reasoning: roleOptions.reasoning,
    serviceTier: roleOptions.serviceTier,
  };
}

export class GenerationPipeline {
  private readonly storage: StorageAdapter;
  private readonly jobManager: JobStateManager;
  private readonly config: ResolvedConfig;
  private readonly catalogModel: LanguageModel;
  private readonly outlineModel: LanguageModel;
  private readonly drafterModel: LanguageModel;
  private readonly workerModel: LanguageModel;
  private readonly reviewerModel: LanguageModel;
  private readonly repoRoot: string;
  private readonly commitHash: string;
  private readonly usageTracker: UsageTracker;
  private readonly artifactStore: ArtifactStore;

  constructor(options: GenerationPipelineOptions) {
    this.storage = options.storage;
    this.jobManager = options.jobManager;
    this.config = options.config;
    this.catalogModel = options.catalogModel;
    this.outlineModel = options.outlineModel;
    this.drafterModel = options.drafterModel;
    this.workerModel = options.workerModel;
    this.reviewerModel = options.reviewerModel;
    this.repoRoot = options.repoRoot;
    this.commitHash = options.commitHash;
    this.usageTracker = options.usageTracker ?? new UsageTracker();
    this.artifactStore = new ArtifactStore(this.storage);
  }

  async run(
    job: GenerationJob,
    options: PipelineRunOptions = {},
  ): Promise<PipelineResult> {
    const slug = job.projectSlug;
    const jobId = job.id;
    const versionId = job.versionId;
    const emitter = new JobEventEmitter(
      this.storage,
      slug,
      jobId,
      versionId,
      options.onEvent,
    );
    const isResume = !!options.resumeWith;

    const pipelineStartedAt = Date.now();
    const throughput = new ThroughputReportBuilder();
    const prefetchRef: { current: PrefetchSlot | null } = { current: null };

    try {
      // === CATALOG PHASE ===
      const catalogStartedAt = Date.now();
      // runCatalogPhase always returns (never throws) so that metrics are
      // available even on failure — the caller checks `result.error` below.
      const catalogPhaseResult = await this.runCatalogPhase(job, emitter, options);
      // Always record catalog cost, even when cataloging failed
      throughput.setCatalog({
        durationMs: Date.now() - catalogStartedAt,
        llmCalls: catalogPhaseResult.metrics?.llmCalls ?? 0,
        usage: catalogPhaseResult.metrics?.usage ?? { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cachedTokens: 0 },
        reused: isResume,
      });
      if (catalogPhaseResult.error || !catalogPhaseResult.wiki) {
        throw new Error(catalogPhaseResult.error ?? "Catalog planning failed");
      }
      job = catalogPhaseResult.job;
      const wiki = catalogPhaseResult.wiki;

      job.summary.totalPages = wiki.reading_order.length;
      if (!isResume) {
        job.summary.succeededPages = 0;
        job.summary.failedPages = 0;
      }
      await this.persistJobSummary(job);

      // === PAGE LOOP ===
      const publishedSummaries: Array<{
        slug: string;
        title: string;
        summary: string;
      }> = [];
      const knownPages: string[] = [];

      // On resume, rebuild context from already-validated pages so that
      // subsequent pages can still reference them.
      const skipSlugs = options.resumeWith?.skipPageSlugs ?? new Set<string>();
      if (isResume) {
        for (const page of wiki.reading_order) {
          if (!skipSlugs.has(page.slug)) continue;
          const meta = await this.artifactStore.loadPageMeta<PageMeta>(
            { projectSlug: slug, jobId, versionId, pageSlug: page.slug },
          );
          if (meta) {
            publishedSummaries.push({
              slug: meta.slug,
              title: meta.title,
              summary: meta.summary,
            });
            knownPages.push(meta.slug);
          }
        }
      }

      const qp = this.config.qualityProfile;

      // Agents are stateless between pages (they only hold a model ref + config),
      // so we construct them once before the loop.
      const allowBash = this.config.retrieval.allowControlledBash;
      const drafterProviderOpts = buildProviderOpts(getModelOptionsForRole(this.config, "drafter"), jobId);
      const workerProviderOpts = buildProviderOpts(getModelOptionsForRole(this.config, "worker"), jobId);
      const outlineProviderOpts = buildProviderOpts(getModelOptionsForRole(this.config, "outline"), jobId);
      const reviewerProviderOpts = buildProviderOpts(getModelOptionsForRole(this.config, "reviewer"), jobId);

      const drafter = new PageDrafter({
        model: this.drafterModel,
        repoRoot: this.repoRoot,
        maxSteps: qp.drafterMaxSteps,
        allowBash,
        providerCallOptions: drafterProviderOpts,
        onStep: (step) => this.usageTracker.add("drafter", (this.drafterModel as unknown as { modelId?: string }).modelId ?? "unknown", step),
      });
      const ladder = new VerificationLadder({
        reviewerModel: this.reviewerModel,
        repoRoot: this.repoRoot,
        l2MaxSteps: qp.reviewerMaxSteps,
        l2VerifyMinCitations: qp.reviewerVerifyMinCitations,
        strictness: qp.reviewerStrictness,
        allowBash,
        providerCallOptions: reviewerProviderOpts,
        onStep: (step) => this.usageTracker.add("reviewer", (this.reviewerModel as unknown as { modelId?: string }).modelId ?? "unknown", step),
      });
      const coordinator =
        qp.forkWorkers > 0
          ? new EvidenceCoordinator({
              plannerModel: this.drafterModel,
              workerModel: this.workerModel,
              repoRoot: this.repoRoot,
              concurrency: qp.forkWorkerConcurrency,
              workerMaxSteps: qp.workerMaxSteps,
              allowBash,
              providerCallOptions: workerProviderOpts,
              onWorkerStep: (step) => this.usageTracker.add("worker", (this.workerModel as unknown as { modelId?: string }).modelId ?? "unknown", step),
            })
          : null;
      const outlinePlanner = new OutlinePlanner({
        model: this.outlineModel,
        providerCallOptions: outlineProviderOpts,
        onStep: (step) => this.usageTracker.add("outline", (this.outlineModel as unknown as { modelId?: string }).modelId ?? "unknown", step),
      });

      const prefetchedSlugs = new Set<string>();

      // Page dispatch is delegated to the ParallelPageScheduler. When
      // qp.pageConcurrency === 1 the scheduler preserves strict serial
      // ordering (gates and semaphore reduce to pass-through). For higher
      // concurrency, pages overlap via per-page reviewGate synchronization.
      // A shared `failed` flag short-circuits subsequent pages once any
      // page has failed — this keeps the fail-fast semantics of the legacy
      // for-loop while still letting in-flight pages finish cleanly.
      let pipelineFailed = false;
      const scheduler = new ParallelPageScheduler<WikiJson["reading_order"][number]>({
        concurrency: qp.pageConcurrency,
        runPage: async ({ page, pageIndex, reviewGate, onFirstReviewStart }) => {
          if (skipSlugs.has(page.slug)) {
            return { success: true };
          }
          if (pipelineFailed) {
            // A prior page already failed — skip downstream pages to match
            // the legacy serial fail-fast behavior.
            return { success: true };
          }

          // Await any prefetch targeting this page (single-flight via prefetchRef).
          let prefetchSlot: PrefetchSlot | null = null;
          let prefetchWaitMs = 0;
          if (prefetchRef.current?.pageSlug === page.slug) {
            const waitStart = Date.now();
            await prefetchRef.current.promise.catch(() => {});
            prefetchWaitMs = Date.now() - waitStart;
            prefetchSlot = prefetchRef.current;
            prefetchRef.current = null;
          }

          // Pass reviewGate only when pageConcurrency > 1; in serial mode
          // omitting it preserves the legacy microtask ordering that
          // mock-heavy tests depend on.
          const workflowCtx = {
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
            setActivePrefetch: (slot: PrefetchSlot | null) => { prefetchRef.current = slot; },
            ...(qp.pageConcurrency > 1 ? { reviewGate, onFirstReviewStart } : {}),
          };

          const pageResult = await this.runPageWorkflow(workflowCtx);

          if (!pageResult.success) {
            pipelineFailed = true;
            return {
              success: false,
              error: pageResult.error,
              pageMetrics: pageResult.pageMetrics,
            };
          }

          job = pageResult.job;

          // Between-page transition is only meaningful in strict-serial mode;
          // at concurrency > 1 multiple pages may finish concurrently and race
          // on job-state.json. The job remains in page_drafting throughout
          // parallel execution and transitions to publishing after runAll.
          if (qp.pageConcurrency === 1 && pageIndex < wiki.reading_order.length - 1) {
            job = await this.jobManager.transition(slug, jobId, "page_drafting");
          }

          return {
            success: true,
            summary: pageResult.summary,
            pageMetrics: pageResult.pageMetrics,
          };
        },
      });

      const pageResults = await scheduler.runAll(wiki.reading_order, publishedSummaries);

      // In parallel mode the per-page savePublishedIndex was skipped inside
      // runPageWorkflow (to avoid races); flush the aggregated index once.
      if (qp.pageConcurrency > 1 && publishedSummaries.length > 0) {
        await this.artifactStore.savePublishedIndex(
          { projectSlug: slug, jobId },
          publishedSummaries,
        );
      }

      // Aggregate throughput metrics in order
      for (const result of pageResults) {
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

      // === PUBLISH ===
      job = await this.jobManager.transition(slug, jobId, "publishing");

      const publisher = new Publisher(this.storage);
      await publisher.publish(slug, jobId, versionId, wiki, this.commitHash);

      job = await this.jobManager.transition(slug, jobId, "completed");
      await emitter.jobCompleted(
        job.summary.totalPages ?? 0,
        job.summary.succeededPages ?? 0,
        job.summary.failedPages ?? 0,
      );

      await this.artifactStore.saveUsage({ projectSlug: slug, jobId }, this.usageTracker.toJSON()).catch(() => {});
      await this.artifactStore.saveThroughputMetrics(
        { projectSlug: slug, jobId },
        throughput.finish({ totalLatencyMs: Date.now() - pipelineStartedAt }),
      ).catch(() => {});
      return { success: true, job, usageTracker: this.usageTracker };
    } catch (err) {
      // Drain any outstanding prefetch so its work is captured
      if (prefetchRef.current) {
        await prefetchRef.current.promise.catch(() => {});
        if (prefetchRef.current.phases.evidence || prefetchRef.current.phases.outline) {
          throughput.setOrphanedPrefetch({ phases: { ...prefetchRef.current.phases } });
        }
      }
      await this.artifactStore.saveThroughputMetrics(
        { projectSlug: slug, jobId },
        throughput.finish({ totalLatencyMs: Date.now() - pipelineStartedAt }),
      ).catch(() => {}); // best-effort, never block failure path
      return this.failJob(job, emitter, (err as Error).message);
    }
  }

  // ---------------------------------------------------------------------------
  // Private: Catalog phase
  // ---------------------------------------------------------------------------

  private async runCatalogPhase(
    job: GenerationJob,
    emitter: JobEventEmitter,
    options: PipelineRunOptions,
  ): Promise<{ job: GenerationJob; wiki: WikiJson | null; error?: string; metrics?: { llmCalls: number; usage: import("../utils/usage-tracker.js").UsageInput } }> {
    const slug = job.projectSlug;
    const jobId = job.id;
    const versionId = job.versionId;

    if (options.resumeWith) {
      // === RESUME PATH ===
      // Skip catalog. Reuse existing wiki.json and meta files.
      const wiki = options.resumeWith.wiki;
      // The job may already be in "page_drafting" (killed mid-run) or
      // "failed" (clean failure). Only transition if not already there.
      if (job.status !== "page_drafting") {
        job = await this.jobManager.transition(slug, jobId, "page_drafting");
      }
      await emitter.jobResumed("page_drafting");
      return { job, wiki };
    }

    // === CATALOGING ===
    job = await this.jobManager.transition(slug, jobId, "cataloging");
    await emitter.jobStarted();

    const catalogPlanner = new CatalogPlanner({
      model: this.catalogModel,
      language: this.config.language,
      maxSteps: this.config.qualityProfile.catalogMaxSteps,
      allowBash: this.config.retrieval.allowControlledBash,
      providerCallOptions: buildProviderOpts(getModelOptionsForRole(this.config, "catalog"), jobId),
      onStep: (step) => this.usageTracker.add("catalog", (this.catalogModel as unknown as { modelId?: string }).modelId ?? "unknown", step),
    });
    const profileResult =
      options.repoProfile ?? (await profileRepo(this.repoRoot, slug));

    const catalogResult = await catalogPlanner.plan(profileResult);
    if (!catalogResult.success || !catalogResult.wiki) {
      // Return normally (with metrics) so the caller can record cost before failing
      return {
        job,
        wiki: null,
        error: catalogResult.error ?? "Catalog planning failed",
        metrics: catalogResult.metrics,
      };
    }

    const wiki = catalogResult.wiki;
    const catalogValidation = validateCatalog(wiki);
    if (!catalogValidation.passed) {
      return {
        job,
        wiki: null,
        error: `Catalog validation failed: ${catalogValidation.errors.join("; ")}`,
        metrics: catalogResult.metrics,
      };
    }

    // Emit catalog warnings so they are observable in events.ndjson
    await emitter.catalogWarnings(catalogValidation.warnings);

    await persistCatalog(this.artifactStore, slug, jobId, versionId, wiki);
    await emitter.catalogCompleted(wiki.reading_order.length);

    job = await this.jobManager.transition(slug, jobId, "page_drafting");
    return { job, wiki, metrics: catalogResult.metrics };
  }

  // ---------------------------------------------------------------------------
  // Private: Single-page workflow (evidence → outline → draft → review → validate → persist)
  // ---------------------------------------------------------------------------

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
    /**
     * Awaited before the first review so publishedSummaries is up-to-date.
     * Omit for the serial / legacy code path to avoid an extra microtask
     * yield that perturbs LLM call ordering in mock-heavy tests.
     */
    reviewGate?: Promise<void>;
    onFirstReviewStart?: () => void;
  }): Promise<{
    success: boolean;
    job: GenerationJob;
    error?: string;
    pageMetrics?: PageThroughputRecord;
    summary?: { slug: string; title: string; summary: string };
  }> {
    const {
      page, pageIndex: i, wiki, slug, jobId, versionId, emitter,
      publishedSummaries, knownPages, qp, allowBash, drafter, ladder,
      coordinator, outlinePlanner, drafterProviderOpts,
      prefetchSlot, prefetchWaitMs, skipSlugs, prefetchedSlugs,
      workerProviderOpts, outlineProviderOpts, reviewerProviderOpts,
      reviewGate, onFirstReviewStart,
    } = ctx;
    let { job } = ctx;

    // === COMPLEXITY SCORING + DYNAMIC PARAM ADJUSTMENT ===
    const complexity = computeComplexity({ coveredFiles: page.covered_files });
    // Cumulative runtime signals — persist across retries so boosts aren't lost
    const runtimeSignals: import("./param-adjuster.js").RuntimeSignals = {};
    let lanePlan = selectExecutionLane({
      preset: this.config.preset,
      base: qp,
      complexity,
      signals: runtimeSignals,
    });
    let lane = lanePlan.lane;
    const initialLane = lane;
    let policy = lanePlan.policy;

    if (process.env.REPOREAD_DEBUG) {
      // Write to debug log file instead of stderr to avoid Ink rendering conflicts
      const debugMsg = `[pipeline] page=${page.slug} complexity=${complexity.score} ` +
        `forkWorkers=${policy.forkWorkers} drafterMaxSteps=${policy.drafterMaxSteps} ` +
        `maxRevisionAttempts=${policy.maxRevisionAttempts} maxOutputTokensBoost=${policy.maxOutputTokensBoost}\n`;
      fs.appendFile(path.join(this.repoRoot, ".reporead", "pipeline-debug.log"), debugMsg).catch(() => {});
    }

    // Emit complexity scored event
    await emitter.pageComplexityScored(page.slug, {
      score: complexity.score,
      fileCount: complexity.fileCount,
      dirSpread: complexity.dirSpread,
      crossLanguage: complexity.crossLanguage,
    });

    // Emit params adjusted event if different from baseline
    if (
      policy.forkWorkers !== qp.forkWorkers ||
      policy.drafterMaxSteps !== qp.drafterMaxSteps ||
      policy.maxRevisionAttempts !== qp.maxRevisionAttempts ||
      policy.maxOutputTokensBoost !== 0
    ) {
      await emitter.pageParamsAdjusted(page.slug, {
        forkWorkers: policy.forkWorkers,
        drafterMaxSteps: policy.drafterMaxSteps,
        maxRevisionAttempts: policy.maxRevisionAttempts,
        maxOutputTokensBoost: policy.maxOutputTokensBoost,
      });
    }

    job = await this.jobManager.updatePage(slug, jobId, page.slug, i + 1);

    const pageStartedAt = Date.now();
    let draftResult: Awaited<ReturnType<typeof drafter.draft>> | null = null;
    let reviewResult: LadderResult | null =
      null;
    let currentVerificationLevel: VerificationLevel = "L0";
    let attempt = 0;
    let reviewUnverified = false;
    // Cached across retries — only re-run when reviewer asks for more evidence
    let evidenceResult: EvidenceCollectionResult | null = null;
    // Outline is planned once after evidence collection and reused across retries
    let outline: PageOutline | null = null;
    const pageRef: PageRef = { projectSlug: slug, jobId, pageSlug: page.slug };
    const versionedRef: VersionedPageRef = { ...pageRef, versionId };

    // Throughput phase metrics — accumulated across revision attempts
    let evidenceMetric: PhaseMetric = zeroPhaseMetric();
    let outlineMetric: PhaseMetric = zeroPhaseMetric();
    const draftMetric: PhaseMetric = zeroPhaseMetric();
    const reviewMetric: PhaseMetric = zeroPhaseMetric();

    // Track whether prefetch artifacts were actually consumed by THIS workflow
    // (disk load succeeded AND we inherited prefetch metrics). This is used to
    // compute an accurate prefetch.hit — not slot.artifactsReady which only
    // tracks whether the prefetcher *wrote* successfully.
    let prefetchHitEvidence = false;
    let prefetchHitOutline = false;

    // Count total evidence-collection attempts (prefetch/disk/inline). Reviewer-
    // triggered re-runs are suppressed once this reaches qp.maxEvidenceAttempts.
    let evidenceCollectionCount = 0;
    if (prefetchSlot?.artifactsReady.evidence) {
      evidenceCollectionCount = 1;
    }

    try {
    while (true) {
      reviewUnverified = false;

      if (attempt === 0 && !evidenceResult) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- reading JSON blob of unknown structure
        const existing = await this.artifactStore.loadEvidence<any>(pageRef);
        if (existing && existing.ledger) {
          evidenceResult = existing as EvidenceCollectionResult;
          // Disk-load also counts as 1 attempt (covers resume-from-prior-job
          // paths where there is no prefetchSlot).
          if (evidenceCollectionCount === 0) evidenceCollectionCount = 1;
          // Also try loading outline
          const existingOutline = await this.artifactStore.loadOutline<PageOutline>(pageRef);
          if (existingOutline) outline = existingOutline;
          // Skip to drafting
          await emitter.pageEvidencePlanned(page.slug, evidenceResult.plan?.tasks?.length ?? 0, false);
          await emitter.pageEvidenceCollected(page.slug, evidenceResult.ledger.length, 0, 0);

          // Disk loaded successfully. Use prefetch metrics if this was prefetched in THIS job.
          if (prefetchSlot?.artifactsReady.evidence && prefetchSlot.phases.evidence) {
            evidenceMetric = prefetchSlot.phases.evidence;
            prefetchHitEvidence = true;
          } else {
            evidenceMetric = { llmCalls: 0, durationMs: 0, usage: { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cachedTokens: 0 }, reused: true };
          }

          if (existingOutline) {
            if (prefetchSlot?.artifactsReady.outline && prefetchSlot.phases.outline) {
              outlineMetric = prefetchSlot.phases.outline;
              prefetchHitOutline = true;
            } else {
              outlineMetric = { llmCalls: 0, durationMs: 0, usage: { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cachedTokens: 0 }, reused: true };
            }
          }
        }
      }

      // === EVIDENCE COLLECTION ===
      // Run on first attempt (if not already loaded from disk), or on
      // retries where reviewer flagged missing_evidence, factual_risks,
      // or scope_violations (suggesting we need more/different files).
      const shouldCollectEvidence =
        coordinator !== null &&
        evidenceCollectionCount < qp.maxEvidenceAttempts &&
        ((attempt === 0 && !evidenceResult) ||
          (attempt > 0 &&
            ((reviewResult?.conclusion?.missing_evidence?.length ?? 0) > 0 ||
              (reviewResult?.conclusion?.factual_risks?.length ?? 0) > 0 ||
              (reviewResult?.conclusion?.scope_violations?.length ?? 0) > 0)));

      let evidenceJustCollected = false;

      if (shouldCollectEvidence) {
        evidenceCollectionCount++;
        evidenceJustCollected = true;
        // Use per-page coordinator when policy has adjusted worker params
        const needsCustomCoordinator =
          policy.workerMaxSteps !== qp.workerMaxSteps ||
          policy.forkWorkerConcurrency !== qp.forkWorkerConcurrency;
        const activeCoordinator = needsCustomCoordinator
          ? new EvidenceCoordinator({
              plannerModel: this.drafterModel,
              workerModel: this.workerModel,
              repoRoot: this.repoRoot,
              concurrency: policy.forkWorkerConcurrency,
              workerMaxSteps: policy.workerMaxSteps,
              allowBash,
              providerCallOptions: workerProviderOpts,
              onWorkerStep: (step) => this.usageTracker.add("worker", (this.workerModel as unknown as { modelId?: string }).modelId ?? "unknown", step),
            })
          : coordinator!;
        const evidenceStartedAt = Date.now();
        evidenceResult = await activeCoordinator.collect({
          pageTitle: page.title,
          pageRationale: page.rationale,
          pageOrder: i + 1,
          coveredFiles: page.covered_files,
          publishedSummaries,
          taskCount: policy.forkWorkers,
          language: this.config.language,
          workerContext: [
            `Project: ${wiki.summary}`,
            `Page plan: ${page.rationale}`,
            ...(attempt > 0 && reviewResult?.conclusion
              ? [
                  `\nPrevious review feedback (attempt ${attempt}):`,
                  ...(reviewResult.conclusion.factual_risks?.length
                    ? [`Factual risks: ${reviewResult.conclusion.factual_risks.join("; ")}`]
                    : []),
                  ...(reviewResult.conclusion.missing_evidence?.length
                    ? [`Missing evidence: ${reviewResult.conclusion.missing_evidence.join("; ")}`]
                    : []),
                  ...(reviewResult.conclusion.scope_violations?.length
                    ? [`Scope violations: ${reviewResult.conclusion.scope_violations.join("; ")}`]
                    : []),
                ]
              : []),
          ].join("\n"),
          // On retry, merge new findings into the existing ledger
          // instead of replacing it from scratch
          ...(attempt > 0 && evidenceResult?.ledger
            ? {
                existingLedger: evidenceResult.ledger,
                focusAreas: reviewResult?.conclusion?.missing_evidence ?? [],
              }
            : {}),
        });
        await emitter.pageEvidencePlanned(
          page.slug,
          evidenceResult.plan.tasks.length,
          evidenceResult.usedFallback,
        );
        await emitter.pageEvidenceCollected(
          page.slug,
          evidenceResult.ledger.length,
          evidenceResult.plan.tasks.length - evidenceResult.failedTaskIds.length,
          evidenceResult.failedTaskIds.length,
        );
        await this.artifactStore.saveEvidence(
          pageRef,
          { ledger: evidenceResult.ledger, findings: evidenceResult.findings, openQuestions: evidenceResult.openQuestions, failedTaskIds: evidenceResult.failedTaskIds },
        );
        evidenceMetric.durationMs += Date.now() - evidenceStartedAt;
        evidenceMetric.llmCalls += evidenceResult.metrics.llmCalls;
        addUsageInput(evidenceMetric.usage, evidenceResult.metrics.usage);
        // If we did real LLM work, this is no longer a pure cache reuse
        if (evidenceResult.metrics.llmCalls > 0) evidenceMetric.reused = false;
      }

      // Derive mechanism list from the current evidence ledger. Empty when
      // coverageEnforcement is "off" or when the ledger has no notes.
      let mechanisms: Mechanism[] = [];
      if (qp.coverageEnforcement !== "off" && evidenceResult) {
        mechanisms = deriveMechanismList(evidenceResult.ledger, page.covered_files);
      }

      // === OUTLINE PLANNING ===
      // Plan the outline after evidence is collected. Re-plan when
      // evidence was just re-collected on a retry (the evidence base
      // changed, so the outline should reflect the new findings).
      if (evidenceResult && (outline === null || evidenceJustCollected)) {
        const outlineStartedAt = Date.now();
        const outlineResult = await outlinePlanner.planWithMetrics({
          pageTitle: page.title,
          pageRationale: page.rationale,
          coveredFiles: page.covered_files,
          language: this.config.language,
          ledger: evidenceResult.ledger,
          findings: evidenceResult.findings,
          mechanisms,
        });
        outline = outlineResult.outline;
        outlineMetric.durationMs += Date.now() - outlineStartedAt;
        outlineMetric.llmCalls += outlineResult.metrics.llmCalls;
        addUsageInput(outlineMetric.usage, outlineResult.metrics.usage);
        if (outlineResult.metrics.llmCalls > 0) outlineMetric.reused = false;
        if (outline) {
          await this.artifactStore.saveOutline(pageRef, outline);
        }
      }

      // Filtered mechanism lists, used by drafter and reviewer. Entries
      // marked out-of-scope by the outline are excluded from both surfaces.
      const outOfScopeIds = (outline?.out_of_scope_mechanisms ?? []).map((x) => x.id);
      const mechanismsForDrafter = mechanisms.filter((m) => !outOfScopeIds.includes(m.id));
      const mechanismsForReviewer = mechanismsForDrafter;

      await emitter.pageDrafting(page.slug);

      // When file paths are available, pass empty in-context content — the
      // drafter will read from files via tools. This keeps the prompt small.
      const hasFilePointers = true; // evidence/outline are always persisted now
      const authorContext: MainAuthorContext = {
        project_summary: wiki.summary,
        full_book_summary: wiki.summary,
        current_page_plan: page.rationale,
        page_kind: page.kind,
        reader_goal: page.readerGoal,
        section_name: page.section,
        previous_page_slug: i > 0 ? wiki.reading_order[i - 1]?.slug : undefined,
        next_page_slug: i < wiki.reading_order.length - 1 ? wiki.reading_order[i + 1]?.slug : undefined,
        published_page_summaries: hasFilePointers ? [] : publishedSummaries,
        evidence_ledger: hasFilePointers ? [] : (evidenceResult?.ledger ?? []),
        ...(!hasFilePointers && evidenceResult
          ? {
              evidence_bundle: {
                findings: evidenceResult.findings,
                open_questions: evidenceResult.openQuestions,
              },
            }
          : {}),
        ...(!hasFilePointers && outline ? { page_outline: outline } : {}),
        evidence_file: path.relative(this.repoRoot, this.storage.paths.evidenceJson(slug, jobId, page.slug)),
        outline_file: outline ? path.relative(this.repoRoot, this.storage.paths.outlineJson(slug, jobId, page.slug)) : undefined,
        published_index_file: path.relative(this.repoRoot, this.storage.paths.publishedIndexJson(slug, jobId)),
        ...(attempt > 0 && draftResult?.markdown && reviewResult?.conclusion
          ? {
              revision: {
                attempt,
                previous_draft: draftResult.markdown,
                feedback: reviewResult.conclusion,
              },
              draft_file: path.relative(this.repoRoot, this.storage.paths.draftPageMd(slug, jobId, versionId, page.slug)),
            }
          : {}),
        ...(mechanismsForDrafter.length > 0 ? { mechanisms: mechanismsForDrafter } : {}),
        ...(outOfScopeIds.length > 0 ? { mechanisms_out_of_scope: outOfScopeIds } : {}),
      };

      // Use a per-page drafter when complexity scoring has adjusted
      // maxSteps or maxOutputTokens beyond the baseline.
      const needsCustomDrafter =
        policy.drafterMaxSteps !== qp.drafterMaxSteps ||
        policy.maxOutputTokensBoost > 0;
      const activeDrafter = needsCustomDrafter
        ? new PageDrafter({
            model: this.drafterModel,
            repoRoot: this.repoRoot,
            maxSteps: policy.drafterMaxSteps,
            allowBash,
            providerCallOptions: drafterProviderOpts,
            ...(policy.maxOutputTokensBoost > 0
              ? { maxOutputTokens: 16384 + policy.maxOutputTokensBoost }
              : {}),
            onStep: (step) => this.usageTracker.add("drafter", (this.drafterModel as unknown as { modelId?: string }).modelId ?? "unknown", step),
          })
        : drafter;

      const draftStartedAt = Date.now();
      draftResult = await activeDrafter.draft(authorContext, {
        slug: page.slug,
        title: page.title,
        order: i + 1,
        coveredFiles: page.covered_files,
        language: this.config.language,
      });
      draftMetric.durationMs += Date.now() - draftStartedAt;
      draftMetric.llmCalls += draftResult.metrics?.llmCalls ?? 0;
      addUsageInput(draftMetric.usage, draftResult.metrics?.usage ?? { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cachedTokens: 0 });

      if (
        !draftResult.success ||
        !draftResult.markdown ||
        !draftResult.metadata
      ) {
        // Include partial metrics so throughput.json captures cost of failed pages
        return {
          success: false,
          job,
          error: draftResult.error ?? `Page ${page.slug} drafting failed`,
          pageMetrics: this.buildPartialPageMetrics(
            page.slug, lane, initialLane, attempt, pageStartedAt,
            evidenceMetric, outlineMetric, draftMetric, reviewMetric, zeroPhaseMetric(),
            currentVerificationLevel,
            prefetchSlot ? {
              hit: prefetchHitEvidence || prefetchHitOutline,
              waitMs: prefetchWaitMs,
              phases: { ...prefetchSlot.phases },
            } : undefined,
          ),
        };
      }

      await emitter.pageDrafted(page.slug);

      // === LOW CITATION DENSITY SIGNAL ===
      // Check if any ## section has zero [cite:...] markers. This drives
      // lowCitationDensity in runtimeSignals → more aggressive review (L2)
      // and higher reviewer citation verification requirements.
      if (draftResult.markdown) {
        const sections = draftResult.markdown.split(/^## /m);
        const hasLowDensity = sections.slice(1).some(
          (section) => (section.match(/\[cite:/g) || []).length === 0,
        );
        if (hasLowDensity && !runtimeSignals.lowCitationDensity) {
          runtimeSignals.lowCitationDensity = true;
          // Re-select lane so policy picks up the new signal BEFORE
          // needsCustomLadder/needsCustomCoordinator evaluate it.
          lanePlan = selectExecutionLane({
            preset: this.config.preset,
            base: qp,
            complexity,
            signals: runtimeSignals,
          });
          lane = lanePlan.lane;
          policy = lanePlan.policy;
        }
      }

      // === TRUNCATION GUARD ===
      // If the draft hit `finishReason === "length"`, the tail of the
      // page (often including the JSON metadata block) was cut off by
      // the model's output-token ceiling. Skip the reviewer entirely
      // and synthesize a "revise" verdict that tells the drafter to
      // produce a shorter page. This avoids publishing half-written
      // content and re-uses the existing revision loop machinery.
      if (draftResult.truncated && attempt < policy.maxRevisionAttempts) {
        // Accumulate truncation signal and re-select lane
        runtimeSignals.draftTruncated = true;
        lanePlan = selectExecutionLane({
          preset: this.config.preset,
          base: qp,
          complexity,
          signals: runtimeSignals,
        });
        lane = lanePlan.lane;
        policy = lanePlan.policy;
        reviewResult = {
          success: true,
          conclusion: {
            verdict: "revise",
            blockers: [
              "Draft output was truncated at the model's max_tokens limit. The page is too long. Make it shorter: merge overlapping sections, trim long code examples to the 3-5 most load-bearing lines, drop non-essential prose. Keep every claim cited.",
            ],
            factual_risks: [],
            missing_evidence: [],
            scope_violations: [],
            suggested_revisions: [],
          },
          levelReached: "L0",
        };
        await emitter.pageReviewed(page.slug, "revise");
        attempt++;
        // Job is already in "page_drafting" state at this point (the
        // reviewing transition happens below the guard), so no state
        // transition is needed — just loop back.
        continue;
      }

      // --- WRITE DRAFT TO DISK BEFORE REVIEW ---
      await this.artifactStore.saveDraftMarkdown(versionedRef, draftResult.markdown!);

      // --- REVIEW ---
      job = await this.jobManager.transition(slug, jobId, "reviewing");

      // Paths must be relative to repoRoot — the reviewer's `read` tool prepends repoRoot
      const draftMdPath = this.storage.paths.draftPageMd(slug, jobId, versionId, page.slug);
      const relDraftFile = path.relative(this.repoRoot, draftMdPath);
      const relPublishedIndex = path.relative(this.repoRoot, this.storage.paths.publishedIndexJson(slug, jobId));

      const briefing: ReviewBriefing = {
        page_title: page.title,
        section_position: `Page ${i + 1} of ${wiki.reading_order.length}`,
        current_page_plan: page.rationale,
        full_book_summary: wiki.summary,
        draft_file: relDraftFile,
        covered_files: page.covered_files,
        published_summaries_file: relPublishedIndex,
        review_questions: [
          "Does the page stay within its assigned scope?",
          "Are all key claims backed by citations from the repository?",
          "Are there covered files that should be referenced but aren't?",
        ],
        ...(attempt > 0 && reviewResult?.conclusion ? {
          previous_review: reviewResult.conclusion,
          revision_diff_summary: `Revision attempt ${attempt} addressing: ${reviewResult.conclusion.blockers.join("; ")}`,
        } : {}),
        ...(mechanismsForReviewer.length > 0 ? { mechanisms_to_verify: mechanismsForReviewer } : {}),
      };

      // Start prefetching the next page's evidence+outline BEFORE review.
      // Review is the longest phase (30s-2min), so overlapping with it
      // gives the best prefetch window. Guarded by prefetchedSlugs to
      // ensure each page is prefetched at most once (revision loop may
      // re-enter this code path).
      const nextIdx = i + 1;
      if (nextIdx < wiki.reading_order.length) {
        const nextPage = wiki.reading_order[nextIdx];
        if (!prefetchedSlugs.has(nextPage.slug) && !skipSlugs.has(nextPage.slug)) {
          prefetchedSlugs.add(nextPage.slug);
          ctx.setActivePrefetch(startPrefetch(nextPage, {
            wiki,
            pageIndex: nextIdx,
            slug,
            jobId,
            language: this.config.language,
            publishedSummaries: [...publishedSummaries],
            artifactStore: this.artifactStore,
            workerModel: this.workerModel,
            drafterModel: this.drafterModel,
            outlineModel: this.outlineModel,
            workerProviderOpts,
            outlineProviderOpts,
            repoRoot: this.repoRoot,
            allowBash,
            onWorkerStep: (step) => this.usageTracker.add("worker", (this.workerModel as unknown as { modelId?: string }).modelId ?? "unknown", step),
            onOutlineStep: (step) => this.usageTracker.add("outline", (this.outlineModel as unknown as { modelId?: string }).modelId ?? "unknown", step),
          }));
        }
      }

      // Use a per-page ladder when policy has adjusted reviewer params
      const needsCustomLadder =
        policy.reviewerMaxSteps !== qp.reviewerMaxSteps ||
        policy.reviewerVerifyMinCitations !== qp.reviewerVerifyMinCitations ||
        policy.reviewerStrictness !== qp.reviewerStrictness;
      const activeLadder = needsCustomLadder
        ? new VerificationLadder({
            reviewerModel: this.reviewerModel,
            repoRoot: this.repoRoot,
            l2MaxSteps: policy.reviewerMaxSteps,
            l2VerifyMinCitations: policy.reviewerVerifyMinCitations,
            strictness: policy.reviewerStrictness,
            allowBash,
            providerCallOptions: reviewerProviderOpts,
            onStep: (step) => this.usageTracker.add("reviewer", (this.reviewerModel as unknown as { modelId?: string }).modelId ?? "unknown", step),
          })
        : ladder;

      // On the first review attempt of this page, wait until the previous
      // page's publishedSummary is available. The scheduler supplies a gate
      // only when pageConcurrency > 1; the legacy serial call site omits it
      // to avoid an extra microtask yield that would perturb LLM call
      // ordering.
      if (attempt === 0 && reviewGate) {
        await reviewGate;
        onFirstReviewStart?.();
      }

      const reviewStartedAt = Date.now();
      try {
        const verificationLevel = selectVerificationLevel({
          lane,
          complexityScore: complexity.score,
          signals: runtimeSignals,
          revisionAttempt: attempt,
        });

        const ladderResult = await activeLadder.verify({
          level: verificationLevel,
          briefing,
          draftContent: draftResult.markdown!,
          validationInput: {
            markdown: draftResult.markdown!,
            citations: draftResult.metadata!.citations,
            knownFiles: page.covered_files,
            knownPages,
            pageSlug: page.slug,
          },
        });
        reviewResult = ladderResult;
        currentVerificationLevel = ladderResult.levelReached;
      } catch (reviewErr) {
        reviewResult = {
          success: false,
          error: `Review threw: ${(reviewErr as Error).message}`,
          levelReached: currentVerificationLevel,
        };
      }
      // Both try & catch branches always assign reviewResult; assert non-null for TS.
      reviewResult = reviewResult!;
      reviewMetric.durationMs += Date.now() - reviewStartedAt;
      reviewMetric.llmCalls += reviewResult.metrics?.llmCalls ?? 0;
      addUsageInput(reviewMetric.usage, reviewResult.metrics?.usage ?? { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cachedTokens: 0 });

      if (!reviewResult.success || !reviewResult.conclusion) {
        // Synthesize an unverified pass so the page can proceed.
        // The page will be flagged for later re-review.
        reviewResult = {
          success: true,
          conclusion: {
            verdict: "pass",
            blockers: [],
            factual_risks: [
              `Reviewer unavailable: ${reviewResult.error ?? "unknown error"}. This page has not been verified.`,
            ],
            missing_evidence: [],
            scope_violations: [],
            suggested_revisions: [],
          },
          levelReached: currentVerificationLevel,
        };
        reviewUnverified = true;
      }

      await emitter.pageReviewed(
        page.slug,
        reviewResult.conclusion!.verdict,
      );

      // Accumulate reviewer feedback signals and re-select lane (preserves prior boosts like truncation)
      if (reviewResult.conclusion) {
        runtimeSignals.factualRisksCount = reviewResult.conclusion.factual_risks.length;
        runtimeSignals.missingEvidenceCount = reviewResult.conclusion.missing_evidence.length;
        lanePlan = selectExecutionLane({
          preset: this.config.preset,
          base: qp,
          complexity,
          signals: runtimeSignals,
        });
        lane = lanePlan.lane;
        policy = lanePlan.policy;
      }

      // Decide whether to retry: if the reviewer says "revise" and we
      // still have budget, always retry — the rationale may be in
      // blockers, factual_risks, missing_evidence, or suggested_revisions.
      // Previously we required non-empty blockers, but that let pages
      // through when the reviewer flagged issues in other fields only.
      const verdict = reviewResult.conclusion!.verdict;
      const canRetry = attempt < policy.maxRevisionAttempts;

      if (verdict === "pass" || !canRetry) {
        break;
      }

      // Retry: increment attempt, drafter will receive revision context
      attempt++;
      job = await this.jobManager.transition(slug, jobId, "page_drafting");
    }

    // After loop: persist final draft + final review
    const finalDraft = draftResult!;
    const finalReview = reviewResult!;

    await this.artifactStore.saveDraftMarkdown(versionedRef, finalDraft.markdown!);
    await this.artifactStore.saveCitations(versionedRef, finalDraft.metadata!.citations);
    await this.artifactStore.saveReview(pageRef, finalReview.conclusion);

    // --- VALIDATE ---
    job = await this.jobManager.transition(slug, jobId, "validating");

    const validateStartedAt = Date.now();
    const validationResult = validatePage({
      markdown: finalDraft.markdown!,
      citations: finalDraft.metadata!.citations,
      knownFiles: page.covered_files,
      knownPages,
      pageSlug: page.slug,
    });
    const validateMetric: PhaseMetric = {
      durationMs: Date.now() - validateStartedAt,
      llmCalls: 0,
      usage: { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cachedTokens: 0 },
    };

    await this.artifactStore.saveValidation(pageRef, validationResult);
    await emitter.pageValidated(page.slug, validationResult.passed);

    // Auto-compute related pages from covered_files overlap
    const relatedFromOverlap = wiki.reading_order
      .filter((p) => p.slug !== page.slug)
      .filter((p) =>
        p.covered_files.some((f) => page.covered_files.includes(f)),
      )
      .map((p) => p.slug);
    const existingRelated = finalDraft.metadata!.related_pages ?? [];
    const mergedRelated = [
      ...new Set([...existingRelated, ...relatedFromOverlap]),
    ];

    // Persist page meta
    const pageMeta = {
      slug: page.slug,
      title: page.title,
      order: i + 1,
      sectionId: page.section ?? page.slug,
      section: page.section,
      group: page.group,
      level: page.level,
      kind: page.kind,
      readerGoal: page.readerGoal,
      prerequisites: page.prerequisites,
      coveredFiles: page.covered_files,
      relatedPages: mergedRelated,
      generatedAt: new Date().toISOString(),
      commitHash: this.commitHash,
      citationFile: `citations/${page.slug}.citations.json`,
      summary: finalDraft.metadata!.summary,
      reviewStatus: reviewUnverified
        ? "unverified"
        : finalReview.conclusion!.verdict === "pass"
          ? "accepted"
          : "accepted_with_notes",
      reviewSummary:
        finalReview.conclusion!.blockers.join("; ") || "No blockers",
      reviewDigest: JSON.stringify(finalReview.conclusion),
      revisionAttempts: attempt,
      status: "validated" as const,
      validation: {
        structurePassed: validationResult.passed,
        mermaidPassed: !validationResult.errors.some((e: string) =>
          e.includes("mermaid"),
        ),
        citationsPassed: !validationResult.errors.some((e: string) =>
          e.includes("citation"),
        ),
        linksPassed: !validationResult.errors.some((e: string) =>
          e.includes("link"),
        ),
        summary: validationResult.passed
          ? ("passed" as const)
          : ("failed" as const),
      },
    };

    await this.artifactStore.savePageMeta(versionedRef, pageMeta);

    // Track progress
    knownPages.push(page.slug);
    const pageSummary = {
      slug: page.slug,
      title: page.title,
      summary: finalDraft.metadata!.summary,
    };
    // In parallel mode the scheduler collects summaries in reading order
    // and writes the index at the end. Serial-path callers also push
    // directly for backwards compatibility.
    if (qp.pageConcurrency === 1) {
      publishedSummaries.push(pageSummary);
      await this.artifactStore.savePublishedIndex(
        { projectSlug: slug, jobId },
        publishedSummaries,
      );
    }
    job.summary.succeededPages = (job.summary.succeededPages ?? 0) + 1;
    await this.persistJobSummary(job);

    // Build page throughput record
    const pageUsage = zeroThroughputUsage();
    for (const pm of [evidenceMetric, outlineMetric, draftMetric, reviewMetric, validateMetric]) {
      pageUsage.inputTokens += pm.usage.inputTokens;
      pageUsage.outputTokens += pm.usage.outputTokens;
      pageUsage.reasoningTokens += pm.usage.reasoningTokens;
      pageUsage.cachedTokens += pm.usage.cachedTokens;
      pageUsage.requests += pm.llmCalls;
    }
    const pageMetrics: PageThroughputRecord = {
      pageSlug: page.slug,
      lane,
      totalLatencyMs: Date.now() - pageStartedAt,
      revisionAttempts: attempt,
      escalatedToDeepLane: lane === "deep" && initialLane !== "deep",
      verificationLevel: currentVerificationLevel,
      phases: {
        evidence: evidenceMetric,
        outline: outlineMetric,
        draft: draftMetric,
        review: reviewMetric,
        validate: validateMetric,
      },
      usage: pageUsage,
      prefetch: prefetchSlot ? {
        hit: prefetchHitEvidence || prefetchHitOutline,
        waitMs: prefetchWaitMs,
        phases: { ...prefetchSlot.phases },
      } : undefined,
    };

    // Only surface the summary when running in parallel mode so the scheduler
    // can append in reading order. Serial mode mutates publishedSummaries
    // directly (above) and expects no second push.
    return {
      success: true,
      job,
      pageMetrics,
      summary: qp.pageConcurrency > 1 ? pageSummary : undefined,
    };

    } catch (err) {
      // Any exception in the page workflow — return failure with partial metrics
      return {
        success: false,
        job,
        error: `Page ${page.slug} failed: ${(err as Error).message}`,
        pageMetrics: this.buildPartialPageMetrics(
          page.slug, lane, initialLane, attempt, pageStartedAt,
          evidenceMetric, outlineMetric, draftMetric, reviewMetric, zeroPhaseMetric(),
          currentVerificationLevel,
          prefetchSlot ? {
            hit: prefetchHitEvidence || prefetchHitOutline,
            waitMs: prefetchWaitMs,
            phases: { ...prefetchSlot.phases },
          } : undefined,
        ),
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Private: helpers
  // ---------------------------------------------------------------------------

  /** Build partial page throughput record from whatever metrics were accumulated before failure. */
  private buildPartialPageMetrics(
    pageSlug: string,
    lane: string,
    initialLane: string,
    attempt: number,
    pageStartedAt: number,
    evidenceMetric: PhaseMetric,
    outlineMetric: PhaseMetric,
    draftMetric: PhaseMetric,
    reviewMetric: PhaseMetric,
    validateMetric: PhaseMetric,
    verificationLevel?: VerificationLevel,
    prefetch?: PageThroughputRecord["prefetch"],
  ): PageThroughputRecord {
    const pageUsage = zeroThroughputUsage();
    for (const pm of [evidenceMetric, outlineMetric, draftMetric, reviewMetric, validateMetric]) {
      pageUsage.inputTokens += pm.usage.inputTokens;
      pageUsage.outputTokens += pm.usage.outputTokens;
      pageUsage.reasoningTokens += pm.usage.reasoningTokens;
      pageUsage.cachedTokens += pm.usage.cachedTokens;
      pageUsage.requests += pm.llmCalls;
    }
    return {
      pageSlug,
      lane: lane as PageThroughputRecord["lane"],
      totalLatencyMs: Date.now() - pageStartedAt,
      revisionAttempts: attempt,
      escalatedToDeepLane: lane === "deep" && initialLane !== "deep",
      verificationLevel,
      phases: { evidence: evidenceMetric, outline: outlineMetric, draft: draftMetric, review: reviewMetric, validate: validateMetric },
      usage: pageUsage,
      prefetch,
    };
  }

  private async persistJobSummary(job: GenerationJob): Promise<void> {
    await this.storage.writeJson(
      this.storage.paths.jobStateJson(job.projectSlug, job.id),
      job,
    );
  }

  private async failJob(
    job: GenerationJob,
    emitter: JobEventEmitter,
    error: string,
  ): Promise<PipelineResult> {
    try {
      job = await this.jobManager.fail(job.projectSlug, job.id, error);
      await emitter.jobFailed(error);
    } catch {
      // Best-effort failure recording
    }
    return { success: false, job, error };
  }
}
