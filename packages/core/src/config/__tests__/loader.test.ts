import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { loadProjectConfig, CONFIG_FILENAME } from "../loader.js";

describe("loadProjectConfig", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "reporead-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("loads valid config from project.json", async () => {
    const projectDir = path.join(tmpDir, ".reporead", "projects", "test-project");
    await fs.mkdir(projectDir, { recursive: true });
    const config = {
      projectSlug: "test-project",
      repoRoot: "/tmp/repo",
      preset: "quality",
      providers: [{ provider: "anthropic", secretRef: "k", enabled: true }],
      roles: {
        "catalog": { model: "claude-opus-4-6", fallback_models: [] },
        "outline": { model: "claude-opus-4-6", fallback_models: [] },
        "drafter": { model: "claude-opus-4-6", fallback_models: [] },
        "worker": { model: "claude-sonnet-4-6", fallback_models: [] },
        "reviewer": { model: "claude-opus-4-6", fallback_models: [] },
      },
    };
    await fs.writeFile(
      path.join(projectDir, CONFIG_FILENAME),
      JSON.stringify(config, null, 2),
    );
    const loaded = await loadProjectConfig(projectDir);
    expect(loaded.projectSlug).toBe("test-project");
  });

  it("throws AppError for missing config", async () => {
    await expect(loadProjectConfig(tmpDir)).rejects.toMatchObject({ code: "CONFIG_NOT_FOUND" });
  });

  it("throws AppError for invalid config", async () => {
    const projectDir = path.join(tmpDir, ".reporead", "projects", "bad");
    await fs.mkdir(projectDir, { recursive: true });
    await fs.writeFile(
      path.join(projectDir, CONFIG_FILENAME),
      JSON.stringify({ bad: true }),
    );
    await expect(loadProjectConfig(projectDir)).rejects.toMatchObject({ code: "CONFIG_INVALID" });
  });
});
