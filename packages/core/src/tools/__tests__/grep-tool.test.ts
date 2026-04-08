import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { grepSearch } from "../grep-tool.js";

describe("grepSearch", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "reporead-grep-"));
    await fs.mkdir(path.join(tmpDir, "src"), { recursive: true });
    await fs.writeFile(path.join(tmpDir, "src", "main.ts"), 'export function main() {\n  console.log("hello");\n}');
    await fs.writeFile(path.join(tmpDir, "src", "utils.ts"), 'export function add(a: number, b: number) {\n  return a + b;\n}');
    await fs.writeFile(path.join(tmpDir, "README.md"), "# Project\n\nThis uses TypeScript.");
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("finds matches with context", async () => {
    const result = await grepSearch(tmpDir, "function", { maxResults: 10 });
    expect(result.success).toBe(true);
    expect(result.matches.length).toBeGreaterThanOrEqual(2);
  });

  it("respects maxResults limit", async () => {
    const result = await grepSearch(tmpDir, "export", { maxResults: 1 });
    expect(result.matches.length).toBeLessThanOrEqual(1);
  });

  it("returns file paths and line numbers", async () => {
    const result = await grepSearch(tmpDir, "console.log");
    expect(result.success).toBe(true);
    expect(result.matches.length).toBe(1);
    expect(result.matches[0].file).toContain("main.ts");
    expect(result.matches[0].line).toBe(2);
  });

  it("handles no matches", async () => {
    const result = await grepSearch(tmpDir, "nonexistent_symbol_xyz");
    expect(result.success).toBe(true);
    expect(result.matches).toHaveLength(0);
  });
});
