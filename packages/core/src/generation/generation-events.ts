import type { StorageAdapter } from "../storage/storage-adapter.js";
import { createAppEvent } from "../events/app-event.js";
import type { AppEvent } from "../types/events.js";
import { EventWriter } from "../events/event-writer.js";
import type { JobStatus } from "../types/generation.js";
import type { ReviewVerdict } from "../types/review.js";

export type PipelineEventCallback = (event: AppEvent) => void;

export class JobEventEmitter {
  private readonly writer: EventWriter;
  private readonly listener?: PipelineEventCallback;
  private lastMeaningfulAt: number = Date.now();
  private stallNotified = false;

  constructor(
    storage: StorageAdapter,
    private readonly projectSlug: string,
    private readonly jobId: string,
    private readonly versionId: string,
    listener?: PipelineEventCallback,
  ) {
    this.writer = new EventWriter(
      storage.paths.eventsNdjson(projectSlug, jobId),
    );
    this.listener = listener;
  }

  /**
   * Milliseconds since the last state-transition event (anything that moves
   * a page through catalog/evidence/outline/draft/review/validate/publish).
   * Heartbeat and stall events are excluded so they don't reset the clock.
   * Used by the pipeline's heartbeat tick to decide whether to emit a
   * `job.stalled` event.
   */
  millisSinceLastMeaningful(): number {
    return Date.now() - this.lastMeaningfulAt;
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

  /**
   * Periodic liveness ping. Updates events.ndjson mtime so external monitors
   * can distinguish "pipeline is churning quietly inside one page" from
   * "pipeline has stalled" without scraping the UI renderer.
   */
  async jobHeartbeat(tick: number): Promise<void> {
    await this.emit("job.heartbeat", { tick });
  }

  /**
   * Fires when the pipeline has gone `stallMs` milliseconds without any
   * state-transition event. Emitted at most once per stall window — the
   * flag resets as soon as a meaningful event fires again, so a recovered-
   * then-re-stalled job produces one event per stall period rather than one
   * per heartbeat.
   */
  async jobStalled(stallMs: number, detail?: Record<string, unknown>): Promise<void> {
    if (this.stallNotified) return;
    // Emit FIRST, then flip the flag. If emit fails (disk full, EIO, etc.),
    // the flag stays false so the next tick can retry; without this order
    // a failed emit would silently lock out future stall notifications until
    // a meaningful event reset the flag.
    await this.emit("job.stalled", { stallMs, ...detail });
    this.stallNotified = true;
  }

  async catalogWarnings(warnings: string[]): Promise<void> {
    if (warnings.length > 0) {
      await this.emit("catalog.warnings", { warnings, count: warnings.length });
    }
  }

  async pageComplexityScored(pageSlug: string, payload: { score: number; fileCount: number; dirSpread: number; crossLanguage: boolean }): Promise<void> {
    await this.emit("page.complexity_scored", payload, pageSlug);
  }

  async pageParamsAdjusted(pageSlug: string, payload: { forkWorkers: number; drafterMaxSteps: number; maxRevisionAttempts: number; maxOutputTokensBoost: number }): Promise<void> {
    await this.emit("page.params_adjusted", payload, pageSlug);
  }

  private async emit(type: string, payload: unknown, pageSlug?: string): Promise<void> {
    const event = createAppEvent("job", type, this.projectSlug, payload, {
      jobId: this.jobId,
      versionId: this.versionId,
      pageSlug,
    });
    await this.writer.write(event);
    this.listener?.(event);
    // Track meaningful progress for stall detection. Heartbeats and stall
    // notices are diagnostic signals about the state of the pipeline itself
    // and must not reset the "last meaningful" clock.
    if (type !== "job.heartbeat" && type !== "job.stalled") {
      this.lastMeaningfulAt = Date.now();
      this.stallNotified = false;
    }
  }
}
