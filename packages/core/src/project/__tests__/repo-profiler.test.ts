import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { profileRepo } from "../repo-profiler.js";

describe("profileRepo", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "reporead-profile-"));
    await fs.mkdir(path.join(tmpDir, ".git"), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ name: "test-repo", main: "src/index.ts" }),
    );
    await fs.mkdir(path.join(tmpDir, "src"), { recursive: true });
    await fs.writeFile(path.join(tmpDir, "src", "index.ts"), "export const main = true;");
    await fs.writeFile(path.join(tmpDir, "src", "utils.ts"), "export const add = (a: number, b: number) => a + b;");
    await fs.writeFile(path.join(tmpDir, "README.md"), "# Test Repo");
    await fs.mkdir(path.join(tmpDir, "docs"), { recursive: true });
    await fs.writeFile(path.join(tmpDir, "docs", "guide.md"), "# Guide");
    await fs.writeFile(path.join(tmpDir, "tsconfig.json"), "{}");
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("detects TypeScript as a language", async () => {
    const profile = await profileRepo(tmpDir, "test-repo");
    expect(profile.languages).toContain("TypeScript");
  });

  it("detects npm as package manager", async () => {
    const profile = await profileRepo(tmpDir, "test-repo");
    expect(profile.packageManagers).toContain("npm");
  });

  it("finds entry files", async () => {
    const profile = await profileRepo(tmpDir, "test-repo");
    expect(profile.entryFiles.length).toBeGreaterThanOrEqual(1);
    expect(profile.entryFiles.some((f) => f.includes("index.ts"))).toBe(true);
  });

  it("finds important directories", async () => {
    const profile = await profileRepo(tmpDir, "test-repo");
    expect(profile.importantDirs).toContain("src");
  });

  it("counts source and doc files", async () => {
    const profile = await profileRepo(tmpDir, "test-repo");
    expect(profile.sourceFileCount).toBe(2);
    expect(profile.docFileCount).toBeGreaterThanOrEqual(2);
  });

  it("generates a tree summary string", async () => {
    const profile = await profileRepo(tmpDir, "test-repo");
    expect(profile.treeSummary).toContain("src");
    expect(profile.treeSummary.length).toBeGreaterThan(0);
  });

  it("sets projectSlug and repoRoot", async () => {
    const profile = await profileRepo(tmpDir, "test-repo");
    expect(profile.projectSlug).toBe("test-repo");
    expect(profile.repoRoot).toBe(tmpDir);
  });
});
