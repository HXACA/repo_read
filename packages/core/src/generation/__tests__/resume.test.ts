import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { determineResumePoint } from "../resume.js";
import { StorageAdapter } from "../../storage/storage-adapter.js";
import type { GenerationJob } from "../../types/generation.js";

const baseJob: GenerationJob = {
  id: "job-1",
  projectSlug: "proj",
  repoRoot: "/tmp/repo",
  versionId: "v1",
  status: "interrupted",
  createdAt: "2026-01-01T00:00:00Z",
  startedAt: "2026-01-01T00:00:01Z",
  configSnapshot: {} as never,
  currentPageSlug: "core",
  nextPageOrder: 2,
  summary: { totalPages: 3, succeededPages: 1, failedPages: 0 },
};

describe("determineResumePoint", () => {
  let tmpDir: string;
  let storage: StorageAdapter;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "reporead-resume-"));
    storage = new StorageAdapter(tmpDir);
    await storage.initialize();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("returns cataloging when interrupted at cataloging", async () => {
    const job = { ...baseJob, status: "interrupted" as const, currentPageSlug: undefined };
    const result = await determineResumePoint(storage, job);
    expect(result.stage).toBe("cataloging");
  });

  it("returns page_drafting when draft exists but no review", async () => {
    const job = { ...baseJob };
    const draftDir = storage.paths.draftDir("proj", "job-1", "v1");
    await fs.mkdir(path.join(draftDir, "pages"), { recursive: true });
    await fs.writeFile(storage.paths.draftPageMd("proj", "job-1", "v1", "core"), "# Core");

    const result = await determineResumePoint(storage, job);
    expect(result.stage).toBe("page_drafting");
    expect(result.pageSlug).toBe("core");
  });

  it("returns reviewing when draft and page exist but no review", async () => {
    const job = { ...baseJob };
    const draftDir = storage.paths.draftDir("proj", "job-1", "v1");
    await fs.mkdir(path.join(draftDir, "pages"), { recursive: true });
    await fs.writeFile(storage.paths.draftPageMd("proj", "job-1", "v1", "core"), "# Core\n\nContent.");
    await storage.writeJson(storage.paths.draftPageMeta("proj", "job-1", "v1", "core"), { slug: "core", status: "drafted" });

    const result = await determineResumePoint(storage, job);
    expect(result.stage).toBe("reviewing");
    expect(result.pageSlug).toBe("core");
  });

  it("returns validating when review exists but no validation", async () => {
    const job = { ...baseJob };
    const draftDir = storage.paths.draftDir("proj", "job-1", "v1");
    await fs.mkdir(path.join(draftDir, "pages"), { recursive: true });
    await fs.writeFile(storage.paths.draftPageMd("proj", "job-1", "v1", "core"), "# Core\n\nContent.");
    await storage.writeJson(storage.paths.draftPageMeta("proj", "job-1", "v1", "core"), { slug: "core", status: "reviewed" });
    await storage.writeJson(storage.paths.reviewJson("proj", "job-1", "core"), { verdict: "pass" });

    const result = await determineResumePoint(storage, job);
    expect(result.stage).toBe("validating");
    expect(result.pageSlug).toBe("core");
  });

  it("rejects completed jobs", async () => {
    const job = { ...baseJob, status: "completed" as const };
    const result = await determineResumePoint(storage, job);
    expect(result.canResume).toBe(false);
    expect(result.reason).toContain("completed");
  });
});
