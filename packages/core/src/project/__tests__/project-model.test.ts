import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { ProjectModel } from "../project-model.js";
import { StorageAdapter } from "../../storage/storage-adapter.js";

describe("ProjectModel", () => {
  let tmpDir: string;
  let storage: StorageAdapter;
  let model: ProjectModel;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "reporead-project-"));
    storage = new StorageAdapter(tmpDir);
    await storage.initialize();
    model = new ProjectModel(storage);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("creates a new project", async () => {
    const project = await model.create({
      projectSlug: "test-project",
      repoRoot: tmpDir,
      branch: "main",
    });
    expect(project.projectSlug).toBe("test-project");
    expect(project.createdAt).toBeDefined();
  });

  it("reads a created project", async () => {
    await model.create({ projectSlug: "read-test", repoRoot: tmpDir, branch: "main" });
    const project = await model.get("read-test");
    expect(project).not.toBeNull();
    expect(project!.repoRoot).toBe(tmpDir);
  });

  it("returns null for nonexistent project", async () => {
    const project = await model.get("nonexistent");
    expect(project).toBeNull();
  });

  it("lists all projects", async () => {
    await model.create({ projectSlug: "proj-a", repoRoot: tmpDir, branch: "main" });
    await model.create({ projectSlug: "proj-b", repoRoot: tmpDir, branch: "dev" });
    const list = await model.list();
    expect(list).toHaveLength(2);
  });

  it("rejects duplicate project slug", async () => {
    await model.create({ projectSlug: "dup", repoRoot: tmpDir, branch: "main" });
    await expect(
      model.create({ projectSlug: "dup", repoRoot: tmpDir, branch: "main" }),
    ).rejects.toMatchObject({ code: "PROJECT_ALREADY_EXISTS" });
  });
});
