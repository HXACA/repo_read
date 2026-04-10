import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { LanguageModel } from "ai";
import type { StorageAdapter } from "../storage/storage-adapter.js";
import type { GenerationJob, WikiJson, PageMeta } from "../types/generation.js";
import type { ResolvedConfig } from "../types/config.js";
import type { MainAuthorContext } from "../types/agent.js";
import type { ReviewBriefing } from "../types/review.js";
import { JobStateManager } from "./job-state.js";
import { JobEventEmitter } from "./generation-events.js";
import { profileRepo } from "../project/repo-profiler.js";
import { PageDrafter } from "./page-drafter.js";
import { FreshReviewer } from "../review/reviewer.js";
import { validatePage } from "../validation/page-validator.js";
import { validateCatalog } from "../catalog/catalog-validator.js";
import { CatalogPlanner } from "../catalog/catalog-planner.js";
import { persistCatalog } from "../catalog/catalog-persister.js";
import { Publisher } from "./publisher.js";
import { EvidenceCoordinator, type EvidenceCollectionResult } from "./evidence-coordinator.js";

export type GenerationPipelineOptions = {
  storage: StorageAdapter;
  jobManager: JobStateManager;
  config: ResolvedConfig;
  model: LanguageModel;
  reviewerModel: LanguageModel;
  /**
   * Model used by fork.worker subtasks during evidence collection. Falls
   * back to `model` (main.author's model) when omitted to preserve
   * backwards compatibility with older callers.
   */
  workerModel?: LanguageModel;
  repoRoot: string;
  commitHash: string;
};

export type PipelineResult = {
  success: boolean;
  job: GenerationJob;
  error?: string;
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
};

export class GenerationPipeline {
  private readonly storage: StorageAdapter;
  private readonly jobManager: JobStateManager;
  private readonly config: ResolvedConfig;
  private readonly model: LanguageModel;
  private readonly reviewerModel: LanguageModel;
  private readonly workerModel: LanguageModel;
  private readonly repoRoot: string;
  private readonly commitHash: string;

  constructor(options: GenerationPipelineOptions) {
    this.storage = options.storage;
    this.jobManager = options.jobManager;
    this.config = options.config;
    this.model = options.model;
    this.reviewerModel = options.reviewerModel;
    this.workerModel = options.workerModel ?? options.model;
    this.repoRoot = options.repoRoot;
    this.commitHash = options.commitHash;
  }

  async run(
    job: GenerationJob,
    options: PipelineRunOptions = {},
  ): Promise<PipelineResult> {
    const slug = job.projectSlug;
    const jobId = job.id;
    const versionId = job.versionId;
    const emitter = new JobEventEmitter(this.storage, slug, jobId, versionId);
    const isResume = !!options.resumeWith;

    try {
      let wiki: WikiJson;

      if (options.resumeWith) {
        // === RESUME PATH ===
        // Skip catalog. Reuse existing wiki.json and meta files.
        wiki = options.resumeWith.wiki;
        job = await this.jobManager.transition(slug, jobId, "page_drafting");
        await emitter.jobResumed("page_drafting");
      } else {
        // === CATALOGING ===
        job = await this.jobManager.transition(slug, jobId, "cataloging");
        await emitter.jobStarted();

        const catalogPlanner = new CatalogPlanner({
          model: this.model,
          language: this.config.language,
        });
        const profileResult = await profileRepo(this.repoRoot, slug);

        const catalogResult = await catalogPlanner.plan(profileResult);
        if (!catalogResult.success || !catalogResult.wiki) {
          return this.failJob(
            job,
            emitter,
            catalogResult.error ?? "Catalog planning failed",
          );
        }

        wiki = catalogResult.wiki;
        const catalogValidation = validateCatalog(wiki);
        if (!catalogValidation.passed) {
          return this.failJob(
            job,
            emitter,
            `Catalog validation failed: ${catalogValidation.errors.join("; ")}`,
          );
        }

        await persistCatalog(this.storage, slug, jobId, versionId, wiki);
        await emitter.catalogCompleted(wiki.reading_order.length);

        job = await this.jobManager.transition(slug, jobId, "page_drafting");
      }

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
          const meta = await this.storage.readJson<PageMeta>(
            this.storage.paths.draftPageMeta(slug, jobId, versionId, page.slug),
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
      const MAX_REVISION_ATTEMPTS = qp.maxRevisionAttempts;

      for (let i = 0; i < wiki.reading_order.length; i++) {
        const page = wiki.reading_order[i];

        // Resume path: fast-forward past already-validated pages without
        // re-running their draft/review/validate loops.
        if (skipSlugs.has(page.slug)) {
          continue;
        }

        job = await this.jobManager.updatePage(slug, jobId, page.slug, i + 1);

        // === DRAFT + REVIEW LOOP ===
        const drafter = new PageDrafter({
          model: this.model,
          repoRoot: this.repoRoot,
          maxSteps: qp.drafterMaxSteps,
        });
        const reviewer = new FreshReviewer({
          model: this.reviewerModel,
          repoRoot: this.repoRoot,
          maxSteps: qp.reviewerMaxSteps,
          verifyMinCitations: qp.reviewerVerifyMinCitations,
          strictness: qp.reviewerStrictness,
        });
        const coordinator =
          qp.forkWorkers > 0
            ? new EvidenceCoordinator({
                plannerModel: this.model,
                workerModel: this.workerModel,
                repoRoot: this.repoRoot,
                concurrency: qp.forkWorkerConcurrency,
              })
            : null;

        let draftResult: Awaited<ReturnType<typeof drafter.draft>> | null = null;
        let reviewResult: Awaited<ReturnType<typeof reviewer.review>> | null =
          null;
        let attempt = 0;
        // Cached across retries — only re-run when reviewer asks for more evidence
        let evidenceResult: EvidenceCollectionResult | null = null;

        while (true) {
          // === EVIDENCE COLLECTION ===
          // Run on first attempt, or on retries where reviewer flagged
          // missing_evidence (suggesting we need to look at more files).
          const shouldCollectEvidence =
            coordinator !== null &&
            (attempt === 0 ||
              (reviewResult?.conclusion?.missing_evidence?.length ?? 0) > 0);

          if (shouldCollectEvidence) {
            evidenceResult = await coordinator!.collect({
              pageTitle: page.title,
              pageRationale: page.rationale,
              pageOrder: i + 1,
              coveredFiles: page.covered_files,
              publishedSummaries,
              taskCount: qp.forkWorkers,
              language: this.config.language,
              workerContext: [
                `Project: ${wiki.summary}`,
                `Page plan: ${page.rationale}`,
              ].join("\n\n"),
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
          }

          await emitter.pageDrafting(page.slug);

          const authorContext: MainAuthorContext = {
            project_summary: wiki.summary,
            full_book_summary: wiki.summary,
            current_page_plan: page.rationale,
            published_page_summaries: publishedSummaries,
            evidence_ledger: evidenceResult?.ledger ?? [],
            ...(evidenceResult
              ? {
                  evidence_bundle: {
                    findings: evidenceResult.findings,
                    open_questions: evidenceResult.openQuestions,
                  },
                }
              : {}),
            ...(attempt > 0 && draftResult?.markdown && reviewResult?.conclusion
              ? {
                  revision: {
                    attempt,
                    previous_draft: draftResult.markdown,
                    feedback: reviewResult.conclusion,
                  },
                }
              : {}),
          };

          draftResult = await drafter.draft(authorContext, {
            slug: page.slug,
            title: page.title,
            order: i + 1,
            coveredFiles: page.covered_files,
            language: this.config.language,
          });

          if (
            !draftResult.success ||
            !draftResult.markdown ||
            !draftResult.metadata
          ) {
            return this.failJob(
              job,
              emitter,
              draftResult.error ?? `Page ${page.slug} drafting failed`,
            );
          }

          await emitter.pageDrafted(page.slug);

          // --- REVIEW ---
          job = await this.jobManager.transition(slug, jobId, "reviewing");

          const briefing: ReviewBriefing = {
            page_title: page.title,
            section_position: `Page ${i + 1} of ${wiki.reading_order.length}`,
            current_page_plan: page.rationale,
            full_book_summary: wiki.summary,
            current_draft: draftResult.markdown,
            citations: draftResult.metadata.citations,
            covered_files: page.covered_files,
            review_questions: [
              "Does the page stay within its assigned scope?",
              "Are all key claims backed by citations from the repository?",
              "Are there covered files that should be referenced but aren't?",
            ],
          };

          reviewResult = await reviewer.review(briefing);
          if (!reviewResult.success || !reviewResult.conclusion) {
            return this.failJob(
              job,
              emitter,
              reviewResult.error ?? `Page ${page.slug} review failed`,
            );
          }

          await emitter.pageReviewed(
            page.slug,
            reviewResult.conclusion.verdict,
          );

          // Decide whether to retry: only retry on "revise" verdict with at
          // least one blocker, and only if we haven't hit the attempt limit.
          const verdict = reviewResult.conclusion.verdict;
          const hasBlockers = reviewResult.conclusion.blockers.length > 0;
          const canRetry = attempt < MAX_REVISION_ATTEMPTS;

          if (verdict === "pass" || !hasBlockers || !canRetry) {
            break;
          }

          // Retry: increment attempt, drafter will receive revision context
          attempt++;
          job = await this.jobManager.transition(slug, jobId, "page_drafting");
        }

        // After loop: persist final draft + final review
        const finalDraft = draftResult!;
        const finalReview = reviewResult!;

        const pageMdPath = this.storage.paths.draftPageMd(
          slug,
          jobId,
          versionId,
          page.slug,
        );
        await fs.mkdir(path.dirname(pageMdPath), { recursive: true });
        await fs.writeFile(pageMdPath, finalDraft.markdown!, "utf-8");

        await this.storage.writeJson(
          this.storage.paths.draftCitationsJson(
            slug,
            jobId,
            versionId,
            page.slug,
          ),
          finalDraft.metadata!.citations,
        );

        await this.storage.writeJson(
          this.storage.paths.reviewJson(slug, jobId, page.slug),
          finalReview.conclusion,
        );

        // --- VALIDATE ---
        job = await this.jobManager.transition(slug, jobId, "validating");

        const validationResult = validatePage({
          markdown: finalDraft.markdown!,
          citations: finalDraft.metadata!.citations,
          knownFiles: page.covered_files,
          knownPages,
          pageSlug: page.slug,
        });

        await this.storage.writeJson(
          this.storage.paths.validationJson(slug, jobId, page.slug),
          validationResult,
        );
        await emitter.pageValidated(page.slug, validationResult.passed);

        // Persist page meta
        const pageMeta = {
          slug: page.slug,
          title: page.title,
          order: i + 1,
          sectionId: page.slug,
          coveredFiles: page.covered_files,
          relatedPages: finalDraft.metadata!.related_pages,
          generatedAt: new Date().toISOString(),
          commitHash: this.commitHash,
          citationFile: `citations/${page.slug}.citations.json`,
          summary: finalDraft.metadata!.summary,
          reviewStatus:
            finalReview.conclusion!.verdict === "pass"
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

        await this.storage.writeJson(
          this.storage.paths.draftPageMeta(slug, jobId, versionId, page.slug),
          pageMeta,
        );

        // Track progress
        knownPages.push(page.slug);
        publishedSummaries.push({
          slug: page.slug,
          title: page.title,
          summary: finalDraft.metadata!.summary,
        });
        job.summary.succeededPages = (job.summary.succeededPages ?? 0) + 1;
        await this.persistJobSummary(job);

        // Transition: back to page_drafting for next page, or to publishing for last
        if (i < wiki.reading_order.length - 1) {
          job = await this.jobManager.transition(slug, jobId, "page_drafting");
        }
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

      return { success: true, job };
    } catch (err) {
      return this.failJob(job, emitter, (err as Error).message);
    }
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
