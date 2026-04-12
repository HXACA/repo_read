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
import { FreshReviewer } from "../review/reviewer.js";
import { validatePage } from "../validation/page-validator.js";
import { validateCatalog } from "../catalog/catalog-validator.js";
import { CatalogPlanner } from "../catalog/catalog-planner.js";
import { persistCatalog } from "../catalog/catalog-persister.js";
import { Publisher } from "./publisher.js";
import { EvidenceCoordinator, type EvidenceCollectionResult } from "./evidence-coordinator.js";
import { OutlinePlanner } from "./outline-planner.js";
import type { PageOutline } from "../types/agent.js";
import { computeComplexity } from "./complexity-scorer.js";
import { adjustParams, type AdjustedParams } from "./param-adjuster.js";

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
  /** Real-time event callback for CLI progress display. */
  onEvent?: (event: import("../types/events.js").AppEvent) => void;
  /**
   * Pre-computed repo profile.  When supplied the pipeline skips its own
   * `profileRepo()` call, avoiding a duplicate filesystem walk.
   */
  repoProfile?: RepoProfile;
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
    const emitter = new JobEventEmitter(
      this.storage,
      slug,
      jobId,
      versionId,
      options.onEvent,
    );
    const isResume = !!options.resumeWith;

    try {
      let wiki: WikiJson;

      if (options.resumeWith) {
        // === RESUME PATH ===
        // Skip catalog. Reuse existing wiki.json and meta files.
        wiki = options.resumeWith.wiki;
        // The job may already be in "page_drafting" (killed mid-run) or
        // "failed" (clean failure). Only transition if not already there.
        if (job.status !== "page_drafting") {
          job = await this.jobManager.transition(slug, jobId, "page_drafting");
        }
        await emitter.jobResumed("page_drafting");
      } else {
        // === CATALOGING ===
        job = await this.jobManager.transition(slug, jobId, "cataloging");
        await emitter.jobStarted();

        const catalogPlanner = new CatalogPlanner({
          model: this.model,
          language: this.config.language,
          maxSteps: this.config.qualityProfile.catalogMaxSteps,
        });
        const profileResult =
          options.repoProfile ?? (await profileRepo(this.repoRoot, slug));

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

      // Agents are stateless between pages (they only hold a model ref + config),
      // so we construct them once before the loop.
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
              workerMaxSteps: qp.workerMaxSteps,
            })
          : null;
      const outlinePlanner = new OutlinePlanner({ model: this.model });

      for (let i = 0; i < wiki.reading_order.length; i++) {
        const page = wiki.reading_order[i];

        // Resume path: fast-forward past already-validated pages without
        // re-running their draft/review/validate loops.
        if (skipSlugs.has(page.slug)) {
          continue;
        }

        // === COMPLEXITY SCORING + DYNAMIC PARAM ADJUSTMENT ===
        const complexity = computeComplexity({ coveredFiles: page.covered_files });
        let pageParams: AdjustedParams = adjustParams(qp, complexity);

        if (process.env.REPOREAD_DEBUG) {
          console.error(
            `[pipeline] page=${page.slug} complexity=${complexity.score} ` +
            `forkWorkers=${pageParams.forkWorkers} drafterMaxSteps=${pageParams.drafterMaxSteps} ` +
            `maxRevisionAttempts=${pageParams.maxRevisionAttempts} maxOutputTokensBoost=${pageParams.maxOutputTokensBoost}`,
          );
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
          pageParams.forkWorkers !== qp.forkWorkers ||
          pageParams.drafterMaxSteps !== qp.drafterMaxSteps ||
          pageParams.maxRevisionAttempts !== qp.maxRevisionAttempts ||
          pageParams.maxOutputTokensBoost !== 0
        ) {
          await emitter.pageParamsAdjusted(page.slug, {
            forkWorkers: pageParams.forkWorkers,
            drafterMaxSteps: pageParams.drafterMaxSteps,
            maxRevisionAttempts: pageParams.maxRevisionAttempts,
            maxOutputTokensBoost: pageParams.maxOutputTokensBoost,
          });
        }

        job = await this.jobManager.updatePage(slug, jobId, page.slug, i + 1);

        let draftResult: Awaited<ReturnType<typeof drafter.draft>> | null = null;
        let reviewResult: Awaited<ReturnType<typeof reviewer.review>> | null =
          null;
        let attempt = 0;
        let reviewUnverified = false;
        // Cached across retries — only re-run when reviewer asks for more evidence
        let evidenceResult: EvidenceCollectionResult | null = null;
        // Outline is planned once after evidence collection and reused across retries
        let outline: PageOutline | null = null;
        // Cumulative runtime signals — persist across retries so boosts aren't lost
        const runtimeSignals: import("./param-adjuster.js").RuntimeSignals = {};

        while (true) {
          reviewUnverified = false;

          // === RESUME: load existing evidence + outline from disk ===
          if (attempt === 0 && !evidenceResult) {
            const existing = await this.storage.readJson<any>(this.storage.paths.evidenceJson(slug, jobId, page.slug));
            if (existing && existing.ledger) {
              evidenceResult = existing as EvidenceCollectionResult;
              // Also try loading outline
              const existingOutline = await this.storage.readJson<PageOutline>(this.storage.paths.outlineJson(slug, jobId, page.slug));
              if (existingOutline) outline = existingOutline;
              // Skip to drafting
              await emitter.pageEvidencePlanned(page.slug, evidenceResult.plan?.tasks?.length ?? 0, false);
              await emitter.pageEvidenceCollected(page.slug, evidenceResult.ledger.length, 0, 0);
            }
          }

          // === EVIDENCE COLLECTION ===
          // Run on first attempt (if not already loaded from disk), or on
          // retries where reviewer flagged missing_evidence, factual_risks,
          // or scope_violations (suggesting we need more/different files).
          const shouldCollectEvidence =
            coordinator !== null &&
            ((attempt === 0 && !evidenceResult) ||
              (attempt > 0 &&
                ((reviewResult?.conclusion?.missing_evidence?.length ?? 0) > 0 ||
                  (reviewResult?.conclusion?.factual_risks?.length ?? 0) > 0 ||
                  (reviewResult?.conclusion?.scope_violations?.length ?? 0) > 0)));

          let evidenceJustCollected = false;

          if (shouldCollectEvidence) {
            evidenceJustCollected = true;
            evidenceResult = await coordinator!.collect({
              pageTitle: page.title,
              pageRationale: page.rationale,
              pageOrder: i + 1,
              coveredFiles: page.covered_files,
              publishedSummaries,
              taskCount: pageParams.forkWorkers,
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
            await this.storage.writeJson(
              this.storage.paths.evidenceJson(slug, jobId, page.slug),
              { ledger: evidenceResult.ledger, findings: evidenceResult.findings, openQuestions: evidenceResult.openQuestions, failedTaskIds: evidenceResult.failedTaskIds },
            );
          }

          // === OUTLINE PLANNING ===
          // Plan the outline after evidence is collected. Re-plan when
          // evidence was just re-collected on a retry (the evidence base
          // changed, so the outline should reflect the new findings).
          if (evidenceResult && (outline === null || evidenceJustCollected)) {
            outline = await outlinePlanner.plan({
              pageTitle: page.title,
              pageRationale: page.rationale,
              coveredFiles: page.covered_files,
              language: this.config.language,
              ledger: evidenceResult.ledger,
              findings: evidenceResult.findings,
            });
            if (outline) {
              await this.storage.writeJson(
                this.storage.paths.outlineJson(slug, jobId, page.slug),
                outline,
              );
            }
          }

          await emitter.pageDrafting(page.slug);

          // When file paths are available, pass empty in-context content — the
          // drafter will read from files via tools. This keeps the prompt small.
          const hasFilePointers = true; // evidence/outline are always persisted now
          const authorContext: MainAuthorContext = {
            project_summary: wiki.summary,
            full_book_summary: wiki.summary,
            current_page_plan: page.rationale,
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
            evidence_file: this.storage.paths.evidenceJson(slug, jobId, page.slug),
            outline_file: outline ? this.storage.paths.outlineJson(slug, jobId, page.slug) : undefined,
            published_index_file: this.storage.paths.publishedIndexJson(slug, jobId),
            ...(attempt > 0 && draftResult?.markdown && reviewResult?.conclusion
              ? {
                  revision: {
                    attempt,
                    previous_draft: draftResult.markdown,
                    feedback: reviewResult.conclusion,
                  },
                  draft_file: this.storage.paths.draftPageMd(slug, jobId, versionId, page.slug),
                }
              : {}),
          };

          // Use a per-page drafter when complexity scoring has adjusted
          // maxSteps or maxOutputTokens beyond the baseline.
          const needsCustomDrafter =
            pageParams.drafterMaxSteps !== qp.drafterMaxSteps ||
            pageParams.maxOutputTokensBoost > 0;
          const activeDrafter = needsCustomDrafter
            ? new PageDrafter({
                model: this.model,
                repoRoot: this.repoRoot,
                maxSteps: pageParams.drafterMaxSteps,
                ...(pageParams.maxOutputTokensBoost > 0
                  ? { maxOutputTokens: 16384 + pageParams.maxOutputTokensBoost }
                  : {}),
              })
            : drafter;

          draftResult = await activeDrafter.draft(authorContext, {
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

          // === TRUNCATION GUARD ===
          // If the draft hit `finishReason === "length"`, the tail of the
          // page (often including the JSON metadata block) was cut off by
          // the model's output-token ceiling. Skip the reviewer entirely
          // and synthesize a "revise" verdict that tells the drafter to
          // produce a shorter page. This avoids publishing half-written
          // content and re-uses the existing revision loop machinery.
          if (draftResult.truncated && attempt < pageParams.maxRevisionAttempts) {
            // Accumulate truncation signal and re-adjust params
            runtimeSignals.draftTruncated = true;
            pageParams = adjustParams(qp, complexity, runtimeSignals);
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
            };
            await emitter.pageReviewed(page.slug, "revise");
            attempt++;
            // Job is already in "page_drafting" state at this point (the
            // reviewing transition happens below the guard), so no state
            // transition is needed — just loop back.
            continue;
          }

          // --- WRITE DRAFT TO DISK BEFORE REVIEW ---
          const preDraftMdPath = this.storage.paths.draftPageMd(
            slug,
            jobId,
            versionId,
            page.slug,
          );
          await fs.mkdir(path.dirname(preDraftMdPath), { recursive: true });
          await fs.writeFile(preDraftMdPath, draftResult.markdown!, "utf-8");

          // --- REVIEW ---
          job = await this.jobManager.transition(slug, jobId, "reviewing");

          const briefing: ReviewBriefing = {
            page_title: page.title,
            section_position: `Page ${i + 1} of ${wiki.reading_order.length}`,
            current_page_plan: page.rationale,
            full_book_summary: wiki.summary,
            draft_file: preDraftMdPath,
            covered_files: page.covered_files,
            published_summaries_file: this.storage.paths.publishedIndexJson(slug, jobId),
            review_questions: [
              "Does the page stay within its assigned scope?",
              "Are all key claims backed by citations from the repository?",
              "Are there covered files that should be referenced but aren't?",
            ],
            ...(attempt > 0 && reviewResult?.conclusion ? {
              previous_review: reviewResult.conclusion,
              revision_diff_summary: `Revision attempt ${attempt} addressing: ${reviewResult.conclusion.blockers.join("; ")}`,
            } : {}),
          };

          try {
            reviewResult = await reviewer.review(briefing);
          } catch (reviewErr) {
            reviewResult = {
              success: false,
              error: `Review threw: ${(reviewErr as Error).message}`,
            };
          }

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
            };
            reviewUnverified = true;
          }

          await emitter.pageReviewed(
            page.slug,
            reviewResult.conclusion!.verdict,
          );

          // Accumulate reviewer feedback signals and re-adjust (preserves prior boosts like truncation)
          if (reviewResult.conclusion) {
            runtimeSignals.factualRisksCount = reviewResult.conclusion.factual_risks.length;
            runtimeSignals.missingEvidenceCount = reviewResult.conclusion.missing_evidence.length;
            pageParams = adjustParams(qp, complexity, runtimeSignals);
          }

          // Decide whether to retry: if the reviewer says "revise" and we
          // still have budget, always retry — the rationale may be in
          // blockers, factual_risks, missing_evidence, or suggested_revisions.
          // Previously we required non-empty blockers, but that let pages
          // through when the reviewer flagged issues in other fields only.
          const verdict = reviewResult.conclusion!.verdict;
          const canRetry = attempt < pageParams.maxRevisionAttempts;

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
          sectionId: page.slug,
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
        await this.storage.writeJson(
          this.storage.paths.publishedIndexJson(slug, jobId),
          publishedSummaries,
        );
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
