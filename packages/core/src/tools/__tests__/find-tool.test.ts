import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { findFiles } from "../find-tool.js";

describe("findFiles", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "reporead-find-"));
    await fs.mkdir(path.join(tmpDir, "src"), { recursive: true });
    await fs.mkdir(path.join(tmpDir, "docs"), { recursive: true });
    await fs.writeFile(path.join(tmpDir, "src", "index.ts"), "");
    await fs.writeFile(path.join(tmpDir, "src", "utils.ts"), "");
    await fs.writeFile(path.join(tmpDir, "docs", "guide.md"), "");
    await fs.writeFile(path.join(tmpDir, "README.md"), "");
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("finds TypeScript files by pattern", async () => {
    const result = await findFiles(tmpDir, "**/*.ts");
    expect(result.success).toBe(true);
    expect(result.files.length).toBe(2);
    expect(result.files.some((f) => f.endsWith("index.ts"))).toBe(true);
  });

  it("finds Markdown files", async () => {
    const result = await findFiles(tmpDir, "**/*.md");
    expect(result.success).toBe(true);
    expect(result.files.length).toBe(2);
  });

  it("finds files in specific directory", async () => {
    const result = await findFiles(tmpDir, "src/**/*.ts");
    expect(result.success).toBe(true);
    expect(result.files.length).toBe(2);
  });

  it("returns empty for no matches", async () => {
    const result = await findFiles(tmpDir, "**/*.py");
    expect(result.success).toBe(true);
    expect(result.files).toHaveLength(0);
  });
});
