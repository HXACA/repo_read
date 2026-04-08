import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { Publisher } from "../publisher.js";
import { StorageAdapter } from "../../storage/storage-adapter.js";
import type { WikiJson, VersionJson } from "../../types/generation.js";

describe("Publisher", () => {
  let tmpDir: string;
  let storage: StorageAdapter;

  const slug = "proj";
  const jobId = "job-1";
  const versionId = "v1";

  const wiki: WikiJson = {
    summary: "Test project",
    reading_order: [
      { slug: "overview", title: "Overview", rationale: "Start", covered_files: ["README.md"] },
      { slug: "core", title: "Core", rationale: "Main", covered_files: ["src/index.ts"] },
    ],
  };

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "reporead-publish-"));
    storage = new StorageAdapter(tmpDir);
    await storage.initialize();

    // Create draft structure
    const draftDir = storage.paths.draftDir(slug, jobId, versionId);
    await fs.mkdir(path.join(draftDir, "pages"), { recursive: true });
    await fs.mkdir(path.join(draftDir, "citations"), { recursive: true });

    await storage.writeJson(storage.paths.draftWikiJson(slug, jobId, versionId), wiki);
    await fs.writeFile(storage.paths.draftPageMd(slug, jobId, versionId, "overview"), "# Overview\n\nContent.");
    await fs.writeFile(storage.paths.draftPageMd(slug, jobId, versionId, "core"), "# Core\n\nContent.");
    await storage.writeJson(storage.paths.draftPageMeta(slug, jobId, versionId, "overview"), { slug: "overview", status: "validated" });
    await storage.writeJson(storage.paths.draftPageMeta(slug, jobId, versionId, "core"), { slug: "core", status: "validated" });
    await storage.writeJson(storage.paths.draftCitationsJson(slug, jobId, versionId, "overview"), []);
    await storage.writeJson(storage.paths.draftCitationsJson(slug, jobId, versionId, "core"), []);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("promotes draft to published version", async () => {
    const publisher = new Publisher(storage);
    await publisher.publish(slug, jobId, versionId, wiki, "abc123");

    const vJson = await storage.readJson<VersionJson>(storage.paths.versionJson(slug, versionId));
    expect(vJson).not.toBeNull();
    expect(vJson!.versionId).toBe(versionId);
    expect(vJson!.pageCount).toBe(2);
  });

  it("published version contains all page files", async () => {
    const publisher = new Publisher(storage);
    await publisher.publish(slug, jobId, versionId, wiki, "abc123");

    const overviewMd = await fs.readFile(storage.paths.versionPageMd(slug, versionId, "overview"), "utf-8");
    expect(overviewMd).toContain("# Overview");

    const coreMd = await fs.readFile(storage.paths.versionPageMd(slug, versionId, "core"), "utf-8");
    expect(coreMd).toContain("# Core");
  });

  it("updates current.json with latest version", async () => {
    const publisher = new Publisher(storage);
    await publisher.publish(slug, jobId, versionId, wiki, "abc123");

    const current = await storage.readJson<{ projectSlug: string; versionId: string }>(
      storage.paths.currentJson,
    );
    expect(current).not.toBeNull();
    expect(current!.versionId).toBe(versionId);
  });

  it("writes version.json to draft before promotion", async () => {
    const publisher = new Publisher(storage);
    await publisher.publish(slug, jobId, versionId, wiki, "abc123");

    const versionJsonPath = storage.paths.versionJson(slug, versionId);
    const exists = await storage.exists(versionJsonPath);
    expect(exists).toBe(true);
  });
});
