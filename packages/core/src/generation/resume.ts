import type { StorageAdapter } from "../storage/storage-adapter.js";
import type { GenerationJob, JobStatus } from "../types/generation.js";

export type ResumePoint = {
  canResume: boolean;
  stage?: JobStatus;
  pageSlug?: string;
  reason?: string;
};

const NON_RESUMABLE: JobStatus[] = ["completed", "queued"];

export async function determineResumePoint(
  storage: StorageAdapter,
  job: GenerationJob,
): Promise<ResumePoint> {
  if (NON_RESUMABLE.includes(job.status)) {
    return { canResume: false, reason: `Job is ${job.status} — cannot resume` };
  }

  const slug = job.projectSlug;
  const jobId = job.id;
  const versionId = job.versionId;

  const pageSlug = job.currentPageSlug;

  if (!pageSlug) {
    // No page being processed — resume from cataloging
    return { canResume: true, stage: "cataloging" };
  }

  const hasDraft = await storage.exists(
    storage.paths.draftPageMd(slug, jobId, versionId, pageSlug),
  );

  if (!hasDraft) {
    // Page draft doesn't exist yet — check if wiki exists to determine stage
    const hasWiki = await storage.exists(
      storage.paths.draftWikiJson(slug, jobId, versionId),
    );
    if (!hasWiki) {
      return { canResume: true, stage: "cataloging" };
    }
    return { canResume: true, stage: "page_drafting", pageSlug };
  }

  const hasReview = await storage.exists(
    storage.paths.reviewJson(slug, jobId, pageSlug),
  );

  const hasMeta = await storage.exists(
    storage.paths.draftPageMeta(slug, jobId, versionId, pageSlug),
  );

  if (!hasReview && hasMeta) {
    return { canResume: true, stage: "reviewing", pageSlug };
  }

  if (hasReview) {
    const hasValidation = await storage.exists(
      storage.paths.validationJson(slug, jobId, pageSlug),
    );

    if (!hasValidation) {
      return { canResume: true, stage: "validating", pageSlug };
    }

    return { canResume: true, stage: "page_drafting", pageSlug };
  }

  return { canResume: true, stage: "page_drafting", pageSlug };
}
