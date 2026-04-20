import { describe, it, expect, afterEach, beforeEach } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { createCatalogTools } from "../catalog-tools.js";

describe("catalog-tools symlink-escape protection", () => {
  let repoRoot: string;
  let outside: string;
  let cleanup: string[] = [];

  beforeEach(async () => {
    repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "catalog-repo-"));
    outside = await fs.mkdtemp(path.join(os.tmpdir(), "catalog-outside-"));
    cleanup.push(repoRoot, outside);
  });

  afterEach(async () => {
    for (const d of cleanup) {
      try { await fs.rm(d, { recursive: true, force: true }); } catch { /* ignore */ }
    }
    cleanup = [];
  });

  it("read tool refuses a symlink pointing outside the repo", async () => {
    const secret = path.join(outside, "id_rsa");
    await fs.writeFile(secret, "SUPER SECRET HOST KEY", "utf-8");
    // Repo contains a symlink that appears to be a doc but targets the secret
    const inside = path.join(repoRoot, "docs");
    await fs.mkdir(inside, { recursive: true });
    await fs.symlink(secret, path.join(inside, "secret"));

    const tools = createCatalogTools(repoRoot) as Record<string, { execute: (args: unknown) => Promise<string> }>;
    const result = await tools.read.execute({ path: "docs/secret" });
    expect(result).toMatch(/Path is outside repository root/);
    expect(result).not.toContain("SUPER SECRET");
  });

  it("read tool accepts a normal in-repo file", async () => {
    await fs.writeFile(path.join(repoRoot, "README.md"), "hello", "utf-8");
    const tools = createCatalogTools(repoRoot) as Record<string, { execute: (args: unknown) => Promise<string> }>;
    const result = await tools.read.execute({ path: "README.md" });
    expect(result).toContain("hello");
  });

  it("read tool refuses paths with .. escape even before realpath", async () => {
    const tools = createCatalogTools(repoRoot) as Record<string, { execute: (args: unknown) => Promise<string> }>;
    const result = await tools.read.execute({ path: "../../../etc/passwd" });
    expect(result).toMatch(/Path is outside repository root/);
  });

  it("dir_structure refuses a symlink pointing outside the repo", async () => {
    const outsideDir = path.join(outside, "leaky");
    await fs.mkdir(outsideDir, { recursive: true });
    await fs.writeFile(path.join(outsideDir, "file.txt"), "x", "utf-8");

    const link = path.join(repoRoot, "leaky-link");
    await fs.symlink(outsideDir, link);

    const tools = createCatalogTools(repoRoot) as Record<string, { execute: (args: unknown) => Promise<string> }>;
    const result = await tools.dir_structure.execute({ dir_path: "leaky-link" });
    expect(result).toMatch(/Path is outside repository root/);
    expect(result).not.toContain("file.txt");
  });

  it("read tool accepts an in-repo symlink that points to another in-repo file", async () => {
    // Symlinks internal to the repo are legitimate and should resolve
    await fs.writeFile(path.join(repoRoot, "real.md"), "real content", "utf-8");
    await fs.symlink(path.join(repoRoot, "real.md"), path.join(repoRoot, "alias.md"));

    const tools = createCatalogTools(repoRoot) as Record<string, { execute: (args: unknown) => Promise<string> }>;
    const result = await tools.read.execute({ path: "alias.md" });
    expect(result).toContain("real content");
  });
});
