import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { LanguageModel } from "ai";
import type { StorageAdapter } from "../storage/storage-adapter.js";
import type { GenerationJob, WikiJson } from "../types/generation.js";
import type { ResolvedConfig } from "../types/config.js";
import type { MainAuthorContext } from "../types/agent.js";
import type { ReviewBriefing } from "../types/review.js";
import { JobStateManager } from "./job-state.js";
import { JobEventEmitter } from "./generation-events.js";
import { PageDrafter } from "./page-drafter.js";
import { FreshReviewer } from "../review/reviewer.js";
import { validatePage } from "../validation/page-validator.js";
import { validateCatalog } from "../catalog/catalog-validator.js";
import { CatalogPlanner } from "../catalog/catalog-planner.js";
import { persistCatalog } from "../catalog/catalog-persister.js";
import { Publisher } from "./publisher.js";

export type GenerationPipelineOptions = {
  storage: StorageAdapter;
  jobManager: JobStateManager;
  config: ResolvedConfig;
  model: LanguageModel;
  reviewerModel: LanguageModel;
  repoRoot: string;
  commitHash: string;
};

export type PipelineResult = {
  success: boolean;
  job: GenerationJob;
  error?: string;
};

export class GenerationPipeline {
  private readonly storage: StorageAdapter;
  private readonly jobManager: JobStateManager;
  private readonly config: ResolvedConfig;
  private readonly model: LanguageModel;
  private readonly reviewerModel: LanguageModel;
  private readonly repoRoot: string;
  private readonly commitHash: string;

  constructor(options: GenerationPipelineOptions) {
    this.storage = options.storage;
    this.jobManager = options.jobManager;
    this.config = options.config;
    this.model = options.model;
    this.reviewerModel = options.reviewerModel;
    this.repoRoot = options.repoRoot;
    this.commitHash = options.commitHash;
  }

  async run(job: GenerationJob): Promise<PipelineResult> {
    const slug = job.projectSlug;
    const jobId = job.id;
    const versionId = job.versionId;
    const emitter = new JobEventEmitter(this.storage, slug, jobId, versionId);

    try {
      // === CATALOGING ===
      job = await this.jobManager.transition(slug, jobId, "cataloging");
      await emitter.jobStarted();

      const catalogPlanner = new CatalogPlanner({ model: this.model, language: "en" });
      const profileResult = {
        projectSlug: slug,
        repoRoot: this.repoRoot,
        repoName: slug,
        branch: "main",
        commitHash: this.commitHash,
        languages: [] as string[],
        frameworks: [] as string[],
        packageManagers: [] as string[],
        entryFiles: [] as string[],
        importantDirs: [] as string[],
        ignoredPaths: [] as string[],
        sourceFileCount: 0,
        docFileCount: 0,
        treeSummary: "",
        architectureHints: [] as string[],
      };

      const catalogResult = await catalogPlanner.plan(profileResult);
      if (!catalogResult.success || !catalogResult.wiki) {
        return this.failJob(job, emitter, catalogResult.error ?? "Catalog planning failed");
      }

      const wiki = catalogResult.wiki;
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
      job.summary.totalPages = wiki.reading_order.length;
      job.summary.succeededPages = 0;
      job.summary.failedPages = 0;
      await this.persistJobSummary(job);

      // === PAGE LOOP ===
      const publishedSummaries: Array<{ slug: string; title: string; summary: string }> = [];
      const knownPages: string[] = [];

      for (let i = 0; i < wiki.reading_order.length; i++) {
        const page = wiki.reading_order[i];
        job = await this.jobManager.updatePage(slug, jobId, page.slug, i + 1);

        // --- DRAFT ---
        await emitter.pageDrafting(page.slug);

        const drafter = new PageDrafter({ model: this.model, repoRoot: this.repoRoot });
        const authorContext: MainAuthorContext = {
          project_summary: wiki.summary,
          full_book_summary: wiki.summary,
          current_page_plan: page.rationale,
          published_page_summaries: publishedSummaries,
          evidence_ledger: [],
        };

        const draftResult = await drafter.draft(authorContext, {
          slug: page.slug,
          title: page.title,
          order: i + 1,
          coveredFiles: page.covered_files,
          language: "en",
        });

        if (!draftResult.success || !draftResult.markdown || !draftResult.metadata) {
          return this.failJob(
            job,
            emitter,
            draftResult.error ?? `Page ${page.slug} drafting failed`,
          );
        }

        // Persist draft markdown as raw text (NOT writeJson which would double-encode)
        const pageMdPath = this.storage.paths.draftPageMd(slug, jobId, versionId, page.slug);
        await fs.mkdir(path.dirname(pageMdPath), { recursive: true });
        await fs.writeFile(pageMdPath, draftResult.markdown, "utf-8");

        // Persist citations
        await this.storage.writeJson(
          this.storage.paths.draftCitationsJson(slug, jobId, versionId, page.slug),
          draftResult.metadata.citations,
        );

        await emitter.pageDrafted(page.slug);

        // --- REVIEW ---
        job = await this.jobManager.transition(slug, jobId, "reviewing");

        const reviewer = new FreshReviewer({
          model: this.reviewerModel,
          repoRoot: this.repoRoot,
        });
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

        const reviewResult = await reviewer.review(briefing);
        if (!reviewResult.success || !reviewResult.conclusion) {
          return this.failJob(
            job,
            emitter,
            reviewResult.error ?? `Page ${page.slug} review failed`,
          );
        }

        await this.storage.writeJson(
          this.storage.paths.reviewJson(slug, jobId, page.slug),
          reviewResult.conclusion,
        );
        await emitter.pageReviewed(page.slug, reviewResult.conclusion.verdict);

        // --- VALIDATE ---
        job = await this.jobManager.transition(slug, jobId, "validating");

        const validationResult = validatePage({
          markdown: draftResult.markdown,
          citations: draftResult.metadata.citations,
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
          relatedPages: draftResult.metadata.related_pages,
          generatedAt: new Date().toISOString(),
          commitHash: this.commitHash,
          citationFile: `citations/${page.slug}.citations.json`,
          summary: draftResult.metadata.summary,
          reviewStatus:
            reviewResult.conclusion.verdict === "pass" ? "accepted" : "accepted_with_notes",
          reviewSummary: reviewResult.conclusion.blockers.join("; ") || "No blockers",
          reviewDigest: JSON.stringify(reviewResult.conclusion),
          status: "validated" as const,
          validation: {
            structurePassed: validationResult.passed,
            mermaidPassed: !validationResult.errors.some((e: string) => e.includes("mermaid")),
            citationsPassed: !validationResult.errors.some((e: string) => e.includes("citation")),
            linksPassed: !validationResult.errors.some((e: string) => e.includes("link")),
            summary: validationResult.passed ? ("passed" as const) : ("failed" as const),
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
          summary: draftResult.metadata.summary,
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
