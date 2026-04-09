import { randomUUID } from "node:crypto";
import { AppError } from "../errors.js";
import type { StorageAdapter } from "../storage/storage-adapter.js";
import type { GenerationJob, JobStatus } from "../types/generation.js";
import type { ResolvedConfig } from "../types/config.js";

const VALID_TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  queued: ["cataloging", "failed"],
  cataloging: ["page_drafting", "failed", "interrupted"],
  page_drafting: ["reviewing", "failed", "interrupted"],
  // reviewing → page_drafting allows the retry loop when reviewer requests revisions
  reviewing: ["validating", "page_drafting", "failed", "interrupted"],
  validating: ["page_drafting", "publishing", "failed", "interrupted"],
  publishing: ["completed", "failed"],
  completed: [],
  interrupted: ["cataloging", "page_drafting", "reviewing", "validating"],
  failed: ["cataloging", "page_drafting", "reviewing", "validating"],
};

function generateVersionId(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const h = String(now.getHours()).padStart(2, "0");
  const min = String(now.getMinutes()).padStart(2, "0");
  const s = String(now.getSeconds()).padStart(2, "0");
  return `${y}-${m}-${d}-${h}${min}${s}`;
}

export class JobStateManager {
  constructor(private readonly storage: StorageAdapter) {}

  async create(
    projectSlug: string,
    repoRoot: string,
    config: ResolvedConfig,
  ): Promise<GenerationJob> {
    const job: GenerationJob = {
      id: randomUUID(),
      projectSlug,
      repoRoot,
      versionId: generateVersionId(),
      status: "queued",
      createdAt: new Date().toISOString(),
      configSnapshot: config,
      summary: {},
    };

    await this.persist(projectSlug, job);
    return job;
  }

  async get(projectSlug: string, jobId: string): Promise<GenerationJob | null> {
    return this.storage.readJson<GenerationJob>(
      this.storage.paths.jobStateJson(projectSlug, jobId),
    );
  }

  async transition(
    projectSlug: string,
    jobId: string,
    targetStatus: JobStatus,
  ): Promise<GenerationJob> {
    const job = await this.requireJob(projectSlug, jobId);
    const allowed = VALID_TRANSITIONS[job.status];

    if (!allowed.includes(targetStatus)) {
      throw new AppError(
        "JOB_INVALID_STATE",
        `Cannot transition from "${job.status}" to "${targetStatus}"`,
        { jobId, current: job.status, target: targetStatus },
      );
    }

    job.status = targetStatus;

    if (targetStatus === "cataloging" && !job.startedAt) {
      job.startedAt = new Date().toISOString();
    }
    if (targetStatus === "completed" || targetStatus === "failed") {
      job.finishedAt = new Date().toISOString();
    }

    await this.persist(projectSlug, job);
    return job;
  }

  async fail(
    projectSlug: string,
    jobId: string,
    error: string,
  ): Promise<GenerationJob> {
    const job = await this.requireJob(projectSlug, jobId);
    job.status = "failed";
    job.lastError = error;
    job.finishedAt = new Date().toISOString();
    await this.persist(projectSlug, job);
    return job;
  }

  async updatePage(
    projectSlug: string,
    jobId: string,
    pageSlug: string,
    nextOrder?: number,
  ): Promise<GenerationJob> {
    const job = await this.requireJob(projectSlug, jobId);
    job.currentPageSlug = pageSlug;
    if (nextOrder !== undefined) job.nextPageOrder = nextOrder;
    await this.persist(projectSlug, job);
    return job;
  }

  private async requireJob(projectSlug: string, jobId: string): Promise<GenerationJob> {
    const job = await this.get(projectSlug, jobId);
    if (!job) {
      throw new AppError("JOB_NOT_FOUND", `Job "${jobId}" not found in project "${projectSlug}"`);
    }
    return job;
  }

  private async persist(projectSlug: string, job: GenerationJob): Promise<void> {
    await this.storage.writeJson(
      this.storage.paths.jobStateJson(projectSlug, job.id),
      job,
    );
  }
}
