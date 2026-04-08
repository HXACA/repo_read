import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { PathPolicy } from "../path-policy.js";

describe("PathPolicy", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "reporead-policy-"));
    await fs.writeFile(
      path.join(tmpDir, ".gitignore"),
      "node_modules/\ndist/\n*.log\n.env\n",
    );
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("allows paths inside repo root", async () => {
    const policy = await PathPolicy.create(tmpDir);
    expect(policy.isAllowed("src/index.ts")).toBe(true);
  });

  it("rejects paths outside repo root", async () => {
    const policy = await PathPolicy.create(tmpDir);
    expect(policy.isAllowed("/etc/passwd")).toBe(false);
    expect(policy.isAllowed("../../outside")).toBe(false);
  });

  it("rejects gitignored paths", async () => {
    const policy = await PathPolicy.create(tmpDir);
    expect(policy.isAllowed("node_modules/foo/bar.js")).toBe(false);
    expect(policy.isAllowed("dist/bundle.js")).toBe(false);
    expect(policy.isAllowed("app.log")).toBe(false);
    expect(policy.isAllowed(".env")).toBe(false);
  });

  it("allows non-ignored paths", async () => {
    const policy = await PathPolicy.create(tmpDir);
    expect(policy.isAllowed("src/main.ts")).toBe(true);
    expect(policy.isAllowed("README.md")).toBe(true);
  });

  it("handles missing .gitignore gracefully", async () => {
    const emptyDir = await fs.mkdtemp(path.join(os.tmpdir(), "reporead-no-gi-"));
    try {
      const policy = await PathPolicy.create(emptyDir);
      expect(policy.isAllowed("src/index.ts")).toBe(true);
    } finally {
      await fs.rm(emptyDir, { recursive: true, force: true });
    }
  });

  it("applies additional ignore patterns", async () => {
    const policy = await PathPolicy.create(tmpDir, [".reporead/", "coverage/"]);
    expect(policy.isAllowed(".reporead/current.json")).toBe(false);
    expect(policy.isAllowed("coverage/lcov.info")).toBe(false);
  });
});
