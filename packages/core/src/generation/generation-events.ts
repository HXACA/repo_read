import type { StorageAdapter } from "../storage/storage-adapter.js";
import { createAppEvent } from "../events/app-event.js";
import { EventWriter } from "../events/event-writer.js";
import type { JobStatus } from "../types/generation.js";
import type { ReviewVerdict } from "../types/review.js";

export class JobEventEmitter {
  private readonly writer: EventWriter;

  constructor(
    storage: StorageAdapter,
    private readonly projectSlug: string,
    private readonly jobId: string,
    private readonly versionId: string,
  ) {
    this.writer = new EventWriter(
      storage.paths.eventsNdjson(projectSlug, jobId),
    );
  }

  async jobStarted(): Promise<void> {
    await this.emit("job.started", {});
  }

  async catalogCompleted(totalPages: number): Promise<void> {
    await this.emit("catalog.completed", { totalPages });
  }

  async pageDrafting(pageSlug: string): Promise<void> {
    await this.emit("page.drafting", {}, pageSlug);
  }

  async pageEvidencePlanned(
    pageSlug: string,
    taskCount: number,
    usedFallback: boolean,
  ): Promise<void> {
    await this.emit(
      "page.evidence_planned",
      { taskCount, usedFallback },
      pageSlug,
    );
  }

  async pageEvidenceCollected(
    pageSlug: string,
    citationCount: number,
    workerCount: number,
    failedCount: number,
  ): Promise<void> {
    await this.emit(
      "page.evidence_collected",
      { citationCount, workerCount, failedCount },
      pageSlug,
    );
  }

  async pageDrafted(pageSlug: string): Promise<void> {
    await this.emit("page.drafted", {}, pageSlug);
  }

  async pageReviewed(pageSlug: string, verdict: ReviewVerdict): Promise<void> {
    await this.emit("page.reviewed", { verdict }, pageSlug);
  }

  async pageValidated(pageSlug: string, passed: boolean): Promise<void> {
    await this.emit("page.validated", { passed }, pageSlug);
  }

  async jobInterrupted(recoveryStage: JobStatus, pageSlug?: string): Promise<void> {
    await this.emit("job.interrupted", { recoveryStage }, pageSlug);
  }

  async jobResumed(recoveryStage: JobStatus, pageSlug?: string): Promise<void> {
    await this.emit("job.resumed", { recoveryStage }, pageSlug);
  }

  async jobCompleted(totalPages: number, succeededPages: number, failedPages: number): Promise<void> {
    await this.emit("job.completed", { totalPages, succeededPages, failedPages });
  }

  async jobFailed(error: string): Promise<void> {
    await this.emit("job.failed", { error });
  }

  private async emit(type: string, payload: unknown, pageSlug?: string): Promise<void> {
    const event = createAppEvent("job", type, this.projectSlug, payload, {
      jobId: this.jobId,
      versionId: this.versionId,
      pageSlug,
    });
    await this.writer.write(event);
  }
}
