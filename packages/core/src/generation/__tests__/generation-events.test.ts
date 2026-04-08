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
});
