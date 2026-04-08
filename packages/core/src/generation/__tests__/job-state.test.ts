import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { JobStateManager } from "../job-state.js";
import { StorageAdapter } from "../../storage/storage-adapter.js";
import type { ResolvedConfig } from "../../types/config.js";

describe("JobStateManager", () => {
  let tmpDir: string;
  let storage: StorageAdapter;
  let manager: JobStateManager;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "reporead-job-"));
    storage = new StorageAdapter(tmpDir);
    await storage.initialize();
    manager = new JobStateManager(storage);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("creates a new job in queued state", async () => {
    const job = await manager.create("test-proj", tmpDir, {} as ResolvedConfig);
    expect(job.status).toBe("queued");
    expect(job.projectSlug).toBe("test-proj");
    expect(job.id).toBeDefined();
    expect(job.versionId).toBeDefined();
  });

  it("transitions to cataloging", async () => {
    const job = await manager.create("proj", tmpDir, {} as ResolvedConfig);
    const updated = await manager.transition(job.projectSlug, job.id, "cataloging");
    expect(updated.status).toBe("cataloging");
    expect(updated.startedAt).toBeDefined();
  });

  it("rejects invalid transition", async () => {
    const job = await manager.create("proj", tmpDir, {} as ResolvedConfig);
    await expect(
      manager.transition(job.projectSlug, job.id, "publishing"),
    ).rejects.toMatchObject({ code: "JOB_INVALID_STATE" });
  });

  it("reads job from disk", async () => {
    const job = await manager.create("proj", tmpDir, {} as ResolvedConfig);
    const loaded = await manager.get("proj", job.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe(job.id);
  });

  it("records failure with error message", async () => {
    const job = await manager.create("proj", tmpDir, {} as ResolvedConfig);
    await manager.transition(job.projectSlug, job.id, "cataloging");
    const failed = await manager.fail(job.projectSlug, job.id, "LLM timeout");
    expect(failed.status).toBe("failed");
    expect(failed.lastError).toBe("LLM timeout");
  });
});
