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

  it("dir_structure accepts in-repo dirs even when repoRoot itself is a symlinked path", async () => {
    // Regression: on macOS `/tmp` is a symlink to `/private/tmp`. If the
    // caller hands us a literal repoRoot under `/tmp` and our tool
    // re-computed `path.relative(literalRoot, realpathTarget)`, legitimate
    // in-repo dirs produced `../../../private/...` which then tripped the
    // downstream `outside repository root` check. Simulate the same shape
    // here with an explicit symlinked alias to any temp dir — the test
    // passes on Linux too.
    const aliasRoot = path.join(os.tmpdir(), `alias-root-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    await fs.symlink(repoRoot, aliasRoot);
    cleanup.push(aliasRoot);
    await fs.mkdir(path.join(repoRoot, "docs"), { recursive: true });
    await fs.writeFile(path.join(repoRoot, "docs", "index.md"), "# Hello", "utf-8");

    // Pass the symlinked alias as repoRoot — realpath resolution should
    // normalize it, and dir_structure must still find docs/.
    const tools = createCatalogTools(aliasRoot) as Record<string, { execute: (args: unknown) => Promise<string> }>;
    const result = await tools.dir_structure.execute({ dir_path: "docs" });
    expect(result).not.toMatch(/outside repository root/);
    expect(result).toContain("index.md");
  });

  it("dir_structure accepts repoRoot='.' (default) when the root is symlinked", async () => {
    const aliasRoot = path.join(os.tmpdir(), `alias-root-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    await fs.symlink(repoRoot, aliasRoot);
    cleanup.push(aliasRoot);
    await fs.writeFile(path.join(repoRoot, "README.md"), "r", "utf-8");

    const tools = createCatalogTools(aliasRoot) as Record<string, { execute: (args: unknown) => Promise<string> }>;
    const result = await tools.dir_structure.execute({});
    expect(result).not.toMatch(/outside repository root/);
    expect(result).toContain("README.md");
  });
});
