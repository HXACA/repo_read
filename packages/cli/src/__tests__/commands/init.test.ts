import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { runInit } from "../../commands/init.js";

describe("runInit", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "reporead-init-"));
    await fs.mkdir(path.join(tmpDir, ".git"), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("creates .reporead directory and project.json", async () => {
    await runInit({ repoRoot: tmpDir, projectSlug: "test-init" });
    const projectJson = path.join(tmpDir, ".reporead", "projects", "test-init", "project.json");
    const exists = await fs.stat(projectJson).then(() => true).catch(() => false);
    expect(exists).toBe(true);
  });

  it("creates current.json pointing to new project", async () => {
    await runInit({ repoRoot: tmpDir, projectSlug: "test-init" });
    const currentJson = path.join(tmpDir, ".reporead", "current.json");
    const content = JSON.parse(await fs.readFile(currentJson, "utf-8"));
    expect(content.projectSlug).toBe("test-init");
  });
});
