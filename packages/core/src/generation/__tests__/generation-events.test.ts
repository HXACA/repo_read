import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { JobEventEmitter } from "../generation-events.js";
import { StorageAdapter } from "../../storage/storage-adapter.js";
import { EventReader } from "../../events/event-reader.js";

describe("JobEventEmitter", () => {
  let tmpDir: string;
  let storage: StorageAdapter;
  let emitter: JobEventEmitter;
  let reader: EventReader;

  const slug = "proj";
  const jobId = "job-1";
  const versionId = "v1";

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "reporead-events-"));
    storage = new StorageAdapter(tmpDir);
    await storage.initialize();
    emitter = new JobEventEmitter(storage, slug, jobId, versionId);
    reader = new EventReader(storage.paths.eventsNdjson(slug, jobId));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("emits job.started event", async () => {
    await emitter.jobStarted();
    const events = await reader.readAll();
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("job.started");
    expect(events[0].channel).toBe("job");
    expect(events[0].jobId).toBe(jobId);
    expect(events[0].versionId).toBe(versionId);
  });

  it("emits catalog.completed event", async () => {
    await emitter.catalogCompleted(5);
    const events = await reader.readAll();
    expect(events[0].type).toBe("catalog.completed");
    expect(events[0].payload).toEqual({ totalPages: 5 });
  });

  it("emits page.drafting event with pageSlug", async () => {
    await emitter.pageDrafting("overview");
    const events = await reader.readAll();
    expect(events[0].type).toBe("page.drafting");
    expect(events[0].pageSlug).toBe("overview");
  });

  it("emits page.reviewed event", async () => {
    await emitter.pageReviewed("overview", "pass");
    const events = await reader.readAll();
    expect(events[0].type).toBe("page.reviewed");
    expect(events[0].pageSlug).toBe("overview");
    expect(events[0].payload).toEqual({ verdict: "pass" });
  });

  it("emits page.validated event", async () => {
    await emitter.pageValidated("overview", true);
    const events = await reader.readAll();
    expect(events[0].type).toBe("page.validated");
    expect(events[0].payload).toEqual({ passed: true });
  });

  it("emits job.interrupted with recovery info", async () => {
    await emitter.jobInterrupted("page_drafting", "overview");
    const events = await reader.readAll();
    expect(events[0].type).toBe("job.interrupted");
    expect(events[0].pageSlug).toBe("overview");
    expect(events[0].payload).toEqual({ recoveryStage: "page_drafting" });
  });

  it("emits job.resumed with recovery info", async () => {
    await emitter.jobResumed("reviewing", "core");
    const events = await reader.readAll();
    expect(events[0].type).toBe("job.resumed");
    expect(events[0].pageSlug).toBe("core");
    expect(events[0].payload).toEqual({ recoveryStage: "reviewing" });
  });

  it("emits job.completed event", async () => {
    await emitter.jobCompleted(5, 5, 0);
    const events = await reader.readAll();
    expect(events[0].type).toBe("job.completed");
    expect(events[0].payload).toEqual({ totalPages: 5, succeededPages: 5, failedPages: 0 });
  });

  it("emits page.failed event with slug and error", async () => {
    await emitter.pageFailed("busted-page", "drafter produced empty output", 4);
    const events = await reader.readAll();
    expect(events[0].type).toBe("page.failed");
    expect(events[0].pageSlug).toBe("busted-page");
    expect(events[0].payload).toEqual({
      error: "drafter produced empty output",
      attempt: 4,
    });
  });

  it("page.failed counts as meaningful progress for stall detection", async () => {
    // After a page.failed event fires, the "last meaningful" clock should
    // reset — we don't want the stall detector to fire just because some
    // pages failed; retry churn on subsequent pages is real work.
    await emitter.pageDrafting("overview");
    await new Promise((r) => setTimeout(r, 30));
    await emitter.pageFailed("overview", "boom");
    const after = emitter.millisSinceLastMeaningful();
    expect(after).toBeLessThan(20);
  });

  it("preserves event order across multiple emissions", async () => {
    await emitter.jobStarted();
    await emitter.catalogCompleted(2);
    await emitter.pageDrafting("overview");
    const events = await reader.readAll();
    expect(events.map((e) => e.type)).toEqual([
      "job.started",
      "catalog.completed",
      "page.drafting",
    ]);
  });

  describe("stall detection tracker", () => {
    it("heartbeat does not reset millisSinceLastMeaningful", async () => {
      await emitter.pageDrafting("p1");
      await new Promise((r) => setTimeout(r, 30));
      const before = emitter.millisSinceLastMeaningful();

      await emitter.jobHeartbeat(1);
      await emitter.jobHeartbeat(2);

      const after = emitter.millisSinceLastMeaningful();
      // Heartbeats should not have reset the "last meaningful" clock —
      // it must continue advancing with wall time.
      expect(after).toBeGreaterThanOrEqual(before);
    });

    it("meaningful events reset the clock", async () => {
      await emitter.pageDrafting("p1");
      await new Promise((r) => setTimeout(r, 30));
      await emitter.pageDrafted("p1");
      const just = emitter.millisSinceLastMeaningful();
      expect(just).toBeLessThan(20);
    });

    it("jobStalled suppresses duplicate emits regardless of stallMs value (order-independent gate)", async () => {
      await emitter.jobStalled(900_000);
      await emitter.jobStalled(910_000);
      await emitter.jobStalled(920_000);

      const events = (await reader.readAll()).filter((e) => e.type === "job.stalled");
      expect(events).toHaveLength(1);
      expect((events[0].payload as { stallMs: number }).stallMs).toBe(900_000);
    });

    it("jobStalled re-arms after a meaningful event fires", async () => {
      await emitter.jobStalled(900_000);
      await emitter.jobStalled(920_000); // suppressed

      await emitter.pageDrafted("p1"); // meaningful → clears flag

      await emitter.jobStalled(910_000); // should fire again

      const stalls = (await reader.readAll()).filter((e) => e.type === "job.stalled");
      expect(stalls).toHaveLength(2);
    });

    it("job.stalled includes supplied detail fields", async () => {
      await emitter.jobStalled(900_000, { currentPageSlug: "stuck-page", phase: "drafting" });
      const stall = (await reader.readAll()).find((e) => e.type === "job.stalled")!;
      expect(stall.payload).toEqual({
        stallMs: 900_000,
        currentPageSlug: "stuck-page",
        phase: "drafting",
      });
    });
  });
});
