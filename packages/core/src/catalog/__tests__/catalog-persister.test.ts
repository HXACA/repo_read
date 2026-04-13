import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { persistCatalog } from "../catalog-persister.js";
import { StorageAdapter } from "../../storage/storage-adapter.js";
import { ArtifactStore } from "../../artifacts/artifact-store.js";
import type { WikiJson } from "../../types/generation.js";

describe("persistCatalog", () => {
  let tmpDir: string;
  let storage: StorageAdapter;
  let artifactStore: ArtifactStore;
  const wiki: WikiJson = {
    summary: "A test project for unit testing",
    reading_order: [
      { slug: "overview", title: "Overview", rationale: "Start here", covered_files: ["README.md"] },
      { slug: "core", title: "Core Module", rationale: "Main logic", covered_files: ["src/index.ts"] },
    ],
  };

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "reporead-persist-"));
    storage = new StorageAdapter(tmpDir);
    await storage.initialize();
    artifactStore = new ArtifactStore(storage);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("writes wiki.json to draft directory", async () => {
    await persistCatalog(artifactStore, "proj", "job-1", "v1", wiki);
    const filePath = storage.paths.draftWikiJson("proj", "job-1", "v1");
    const content = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(content);
    expect(parsed.summary).toBe("A test project for unit testing");
    expect(parsed.reading_order).toHaveLength(2);
  });

  it("reading_order is preserved in order", async () => {
    await persistCatalog(artifactStore, "proj", "job-1", "v1", wiki);
    const filePath = storage.paths.draftWikiJson("proj", "job-1", "v1");
    const parsed = JSON.parse(await fs.readFile(filePath, "utf-8"));
    expect(parsed.reading_order[0].slug).toBe("overview");
    expect(parsed.reading_order[1].slug).toBe("core");
  });
});
