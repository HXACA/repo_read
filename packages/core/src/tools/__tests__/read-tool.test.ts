import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { readFile } from "../read-tool.js";

describe("readFile", () => {
  let tmpDir: string;
  let testFile: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "reporead-read-"));
    testFile = path.join(tmpDir, "test.txt");
    const lines = Array.from({ length: 20 }, (_, i) => `Line ${i + 1}`);
    await fs.writeFile(testFile, lines.join("\n"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("reads entire small file with line numbers", async () => {
    const result = await readFile(testFile);
    expect(result.success).toBe(true);
    expect(result.content).toContain("1: Line 1");
    expect(result.content).toContain("20: Line 20");
    expect(result.totalLines).toBe(20);
  });

  it("reads with offset and limit", async () => {
    const result = await readFile(testFile, { offset: 5, limit: 3 });
    expect(result.success).toBe(true);
    expect(result.content).toContain("6: Line 6");
    expect(result.content).toContain("8: Line 8");
    expect(result.content).not.toContain("5: Line 5");
    expect(result.content).not.toContain("9: Line 9");
  });

  it("enforces max 500 line limit", async () => {
    const bigFile = path.join(tmpDir, "big.txt");
    const lines = Array.from({ length: 1000 }, (_, i) => `Line ${i + 1}`);
    await fs.writeFile(bigFile, lines.join("\n"));
    const result = await readFile(bigFile, { limit: 600 });
    expect(result.truncated).toBe(true);
    expect(result.linesReturned).toBeLessThanOrEqual(500);
  });

  it("returns error for nonexistent file", async () => {
    const result = await readFile("/nonexistent/file.txt");
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});
