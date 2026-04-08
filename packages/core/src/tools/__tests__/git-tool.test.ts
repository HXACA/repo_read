import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { gitLog, gitShow, gitDiff } from "../git-tool.js";

const exec = promisify(execFile);

describe("git tools", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "reporead-git-"));
    await exec("git", ["init"], { cwd: tmpDir });
    await exec("git", ["config", "user.email", "test@test.com"], { cwd: tmpDir });
    await exec("git", ["config", "user.name", "Test"], { cwd: tmpDir });
    await fs.writeFile(path.join(tmpDir, "file.txt"), "hello");
    await exec("git", ["add", "."], { cwd: tmpDir });
    await exec("git", ["commit", "-m", "initial"], { cwd: tmpDir });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("gitLog returns recent commits", async () => {
    const result = await gitLog(tmpDir, { maxCount: 5 });
    expect(result.success).toBe(true);
    expect(result.entries.length).toBeGreaterThanOrEqual(1);
    expect(result.entries[0].message).toBe("initial");
  });

  it("gitShow returns commit details", async () => {
    const log = await gitLog(tmpDir, { maxCount: 1 });
    const hash = log.entries[0].hash;
    const result = await gitShow(tmpDir, hash);
    expect(result.success).toBe(true);
    expect(result.content).toContain("initial");
  });

  it("gitDiff returns changes", async () => {
    await fs.writeFile(path.join(tmpDir, "file.txt"), "world");
    const result = await gitDiff(tmpDir);
    expect(result.success).toBe(true);
    expect(result.content).toContain("world");
  });
});
