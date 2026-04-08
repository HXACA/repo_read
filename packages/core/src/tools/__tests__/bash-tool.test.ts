import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { execBash } from "../bash-tool.js";

describe("execBash", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "reporead-bash-"));
    await fs.writeFile(path.join(tmpDir, "a.txt"), "line1\nline2\nline3\n");
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("executes whitelisted commands", async () => {
    const result = await execBash(tmpDir, "wc -l a.txt");
    expect(result.success).toBe(true);
    expect(result.output).toContain("3");
  });

  it("rejects non-whitelisted commands", async () => {
    const result = await execBash(tmpDir, "rm a.txt");
    expect(result.success).toBe(false);
    expect(result.error).toContain("not in whitelist");
  });

  it("rejects redirects", async () => {
    const result = await execBash(tmpDir, "ls > out.txt");
    expect(result.success).toBe(false);
  });

  it("supports pipes between whitelisted commands", async () => {
    const result = await execBash(tmpDir, "ls | wc -l");
    expect(result.success).toBe(true);
  });
});
