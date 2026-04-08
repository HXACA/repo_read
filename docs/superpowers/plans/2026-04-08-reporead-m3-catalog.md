# RepoRead M3: Repo Profiler, Catalog & Lightweight Manifests

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the repo profiling, path policy, retrieval tool layer, and LLM-driven catalog planner so that `repo-read generate` can scan a repository and produce a validated `wiki.json` reading order.

**Architecture:** Repo Profiler scans the filesystem to produce a `RepoProfile`. Path Policy enforces gitignore + readonly boundaries. Retrieval Tools wrap system commands (rg, find, git, bash) behind a unified interface. Catalog Planner uses Vercel AI SDK `generateText` with tool-calling to let the LLM explore the repo and output a structured `wiki.json`. A deterministic Catalog Validator checks the output before persistence.

**Tech Stack:** Node.js 22, TypeScript strict, Vercel AI SDK (`ai`, `@ai-sdk/anthropic`, `@ai-sdk/openai`), `@vscode/ripgrep`, `ignore` (gitignore parser), `glob` (file matching), Zod v4, Vitest

---

## Scope

This plan covers **B030-B035** (all P0 tasks + catalog validation). **B036 (Golden Fixtures)** is deferred — it requires real LLM output samples which are better collected after the planner is running.

**Not in scope:** Page generation (M4), full agent loop with fork.worker/fresh.reviewer (M4), Web UI (deferred), CLI generate command wiring (M6).

---

## New Dependencies to Install

Before starting, install these in `@reporead/core`:

```bash
pnpm --filter @reporead/core add @vscode/ripgrep ignore glob
pnpm --filter @reporead/core add -D @types/glob
```

- `@vscode/ripgrep`: Provides bundled `rg` binary path
- `ignore`: Parse `.gitignore` files
- `glob`: File pattern matching (for Find tool)

---

## File Structure

### New files in packages/core/src/

```
project/
├── repo-profiler.ts              # B030: Scan repo, detect languages/frameworks/entries
├── __tests__/
│   └── repo-profiler.test.ts

policy/
├── index.ts
├── path-policy.ts                # B031: Gitignore + additional ignore + path guard
├── bash-whitelist.ts             # B031: Bash command validation
├── __tests__/
│   ├── path-policy.test.ts
│   └── bash-whitelist.test.ts

tools/
├── index.ts
├── tool-types.ts                 # B032: Shared ToolResult type
├── read-tool.ts                  # B032: Windowed file reading
├── grep-tool.ts                  # B032: ripgrep wrapper
├── find-tool.ts                  # B032: glob-based file discovery
├── git-tool.ts                   # B032: git info extraction
├── bash-tool.ts                  # B032: Whitelist-enforced shell
├── page-read-tool.ts             # B032: Read published pages (stub for M3)
├── citation-open-tool.ts         # B032: Resolve citations (stub for M3)
├── __tests__/
│   ├── read-tool.test.ts
│   ├── grep-tool.test.ts
│   ├── find-tool.test.ts
│   ├── git-tool.test.ts
│   └── bash-tool.test.ts

catalog/
├── index.ts
├── catalog-prompt.ts             # B033: Build system + user prompts
├── catalog-tools.ts              # B033: AI SDK tool definitions for catalog agent
├── catalog-planner.ts            # B033: LLM agent loop producing WikiJson
├── catalog-validator.ts          # B035: Deterministic wiki.json validation
├── catalog-persister.ts          # B034: Write wiki.json to draft
├── __tests__/
│   ├── catalog-prompt.test.ts
│   ├── catalog-planner.test.ts
│   ├── catalog-validator.test.ts
│   └── catalog-persister.test.ts
```

---

## Task 1: Repo Profiler (B030)

**Files:**
- Create: `packages/core/src/project/repo-profiler.ts`
- Test: `packages/core/src/project/__tests__/repo-profiler.test.ts`
- Modify: `packages/core/src/project/index.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/project/__tests__/repo-profiler.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { profileRepo } from "../repo-profiler.js";

describe("profileRepo", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "reporead-profile-"));
    // Create a minimal repo structure
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
    expect(profile.sourceFileCount).toBe(2); // index.ts, utils.ts
    expect(profile.docFileCount).toBeGreaterThanOrEqual(2); // README.md, guide.md
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @reporead/core test -- src/project/__tests__/repo-profiler`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement repo profiler**

```ts
// packages/core/src/project/repo-profiler.ts
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { RepoProfile } from "../types/project.js";

const execFileAsync = promisify(execFile);

const LANGUAGE_EXTENSIONS: Record<string, string> = {
  ".ts": "TypeScript", ".tsx": "TypeScript",
  ".js": "JavaScript", ".jsx": "JavaScript", ".mjs": "JavaScript",
  ".py": "Python",
  ".rs": "Rust",
  ".go": "Go",
  ".java": "Java",
  ".kt": "Kotlin",
  ".rb": "Ruby",
  ".php": "PHP",
  ".cs": "C#",
  ".cpp": "C++", ".cc": "C++", ".cxx": "C++",
  ".c": "C", ".h": "C",
  ".swift": "Swift",
  ".scala": "Scala",
  ".zig": "Zig",
};

const SOURCE_EXTENSIONS = new Set(Object.keys(LANGUAGE_EXTENSIONS));
const DOC_EXTENSIONS = new Set([".md", ".txt", ".rst", ".adoc"]);

const FRAMEWORK_INDICATORS: Record<string, { file: string; framework: string }[]> = {
  root: [
    { file: "next.config.ts", framework: "Next.js" },
    { file: "next.config.js", framework: "Next.js" },
    { file: "next.config.mjs", framework: "Next.js" },
    { file: "nuxt.config.ts", framework: "Nuxt" },
    { file: "vite.config.ts", framework: "Vite" },
    { file: "angular.json", framework: "Angular" },
    { file: "Cargo.toml", framework: "Rust/Cargo" },
    { file: "go.mod", framework: "Go Modules" },
    { file: "build.gradle", framework: "Gradle" },
    { file: "pom.xml", framework: "Maven" },
    { file: "Gemfile", framework: "Ruby/Bundler" },
    { file: "pyproject.toml", framework: "Python/pyproject" },
    { file: "setup.py", framework: "Python/setuptools" },
    { file: "Dockerfile", framework: "Docker" },
    { file: "docker-compose.yml", framework: "Docker Compose" },
    { file: "docker-compose.yaml", framework: "Docker Compose" },
  ],
};

const PACKAGE_MANAGER_FILES: Record<string, string> = {
  "package-lock.json": "npm",
  "yarn.lock": "yarn",
  "pnpm-lock.yaml": "pnpm",
  "bun.lockb": "bun",
  "Cargo.lock": "cargo",
  "go.sum": "go",
  "Gemfile.lock": "bundler",
  "poetry.lock": "poetry",
  "requirements.txt": "pip",
  "Pipfile.lock": "pipenv",
};

const ENTRY_PATTERNS = [
  "src/index.ts", "src/index.js", "src/main.ts", "src/main.js",
  "src/app.ts", "src/app.js", "index.ts", "index.js",
  "main.ts", "main.js", "app.ts", "app.js",
  "src/lib.rs", "main.go", "cmd/main.go",
  "main.py", "app.py", "manage.py",
];

const IMPORTANT_DIR_NAMES = new Set([
  "src", "lib", "app", "api", "cmd", "pkg", "internal",
  "core", "server", "client", "components", "pages",
  "routes", "models", "services", "utils", "helpers",
  "tests", "test", "__tests__", "spec",
]);

const IGNORED_DIRS = new Set([
  "node_modules", ".git", ".next", "dist", "build", "out",
  "target", "vendor", "__pycache__", ".venv", "venv",
  ".reporead", "coverage", ".turbo",
]);

export async function profileRepo(
  repoRoot: string,
  projectSlug: string,
): Promise<RepoProfile> {
  const languages = new Set<string>();
  const frameworks: string[] = [];
  const packageManagers: string[] = [];
  const entryFiles: string[] = [];
  const importantDirs: string[] = [];
  const ignoredPaths: string[] = [...IGNORED_DIRS];
  let sourceFileCount = 0;
  let docFileCount = 0;

  // Detect frameworks from root config files
  const rootFiles = await safeReaddir(repoRoot);
  for (const indicator of FRAMEWORK_INDICATORS.root) {
    if (rootFiles.includes(indicator.file)) {
      if (!frameworks.includes(indicator.framework)) {
        frameworks.push(indicator.framework);
      }
    }
  }

  // Detect package managers
  for (const [file, manager] of Object.entries(PACKAGE_MANAGER_FILES)) {
    if (rootFiles.includes(file)) {
      if (!packageManagers.includes(manager)) {
        packageManagers.push(manager);
      }
    }
  }
  // If package.json exists but no lock file detected, default to npm
  if (rootFiles.includes("package.json") && packageManagers.length === 0) {
    packageManagers.push("npm");
  }

  // Walk directory tree (max depth 5)
  const treeLines: string[] = [];
  await walkDir(repoRoot, repoRoot, 0, 5, (relPath, isDir, depth) => {
    if (isDir) {
      const dirName = path.basename(relPath);
      if (IMPORTANT_DIR_NAMES.has(dirName) && depth <= 2) {
        if (!importantDirs.includes(dirName)) {
          importantDirs.push(dirName);
        }
      }
      if (depth <= 2) {
        treeLines.push("  ".repeat(depth) + dirName + "/");
      }
    } else {
      const ext = path.extname(relPath).toLowerCase();
      const lang = LANGUAGE_EXTENSIONS[ext];
      if (lang) {
        languages.add(lang);
        sourceFileCount++;
      }
      if (DOC_EXTENSIONS.has(ext)) {
        docFileCount++;
      }
      if (depth <= 1) {
        treeLines.push("  ".repeat(depth) + path.basename(relPath));
      }
    }
  });

  // Detect entry files
  for (const pattern of ENTRY_PATTERNS) {
    const fullPath = path.join(repoRoot, pattern);
    try {
      await fs.access(fullPath);
      entryFiles.push(pattern);
    } catch {
      // not found
    }
  }

  // Get git info
  const { branch, commitHash } = await getGitInfo(repoRoot);

  // Architecture hints from package.json
  const architectureHints: string[] = [];
  if (rootFiles.includes("package.json")) {
    try {
      const pkg = JSON.parse(await fs.readFile(path.join(repoRoot, "package.json"), "utf-8"));
      if (pkg.workspaces || rootFiles.includes("pnpm-workspace.yaml")) {
        architectureHints.push("monorepo");
      }
      if (pkg.main) architectureHints.push(`main: ${pkg.main}`);
    } catch { /* ignore */ }
  }

  return {
    projectSlug,
    repoRoot,
    repoName: path.basename(repoRoot),
    branch,
    commitHash,
    languages: [...languages],
    frameworks,
    packageManagers,
    entryFiles,
    importantDirs,
    ignoredPaths,
    sourceFileCount,
    docFileCount,
    treeSummary: treeLines.join("\n"),
    architectureHints,
  };
}

async function walkDir(
  base: string,
  dir: string,
  depth: number,
  maxDepth: number,
  visitor: (relPath: string, isDir: boolean, depth: number) => void,
): Promise<void> {
  if (depth > maxDepth) return;

  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry) || entry.startsWith(".")) continue;
    const fullPath = path.join(dir, entry);
    const relPath = path.relative(base, fullPath);
    let stat;
    try {
      stat = await fs.stat(fullPath);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      visitor(relPath, true, depth);
      await walkDir(base, fullPath, depth + 1, maxDepth, visitor);
    } else {
      visitor(relPath, false, depth);
    }
  }
}

async function getGitInfo(repoRoot: string): Promise<{ branch: string; commitHash: string }> {
  try {
    const { stdout: branch } = await execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: repoRoot });
    const { stdout: hash } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repoRoot });
    return { branch: branch.trim(), commitHash: hash.trim() };
  } catch {
    return { branch: "unknown", commitHash: "unknown" };
  }
}

async function safeReaddir(dir: string): Promise<string[]> {
  try {
    return await fs.readdir(dir);
  } catch {
    return [];
  }
}
```

- [ ] **Step 4: Update project/index.ts**

```ts
// packages/core/src/project/index.ts
export { ProjectModel } from "./project-model.js";
export type { CreateProjectInput } from "./project-model.js";
export { profileRepo } from "./repo-profiler.js";
```

- [ ] **Step 5: Update core index.ts**

Add to `packages/core/src/index.ts`:
```ts
export { profileRepo } from "./project/index.js";
```

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @reporead/core test -- src/project/__tests__/repo-profiler`
Expected: PASS — all 7 tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/project/ packages/core/src/index.ts
git commit -m "feat(B030): repo profiler

Scan repo for languages, frameworks, package managers, entry files,
important directories. Generate tree summary and architecture hints.
Heuristic-based detection via file extensions and config files."
```

---

## Task 2: Path Policy and Bash Whitelist (B031)

**Files:**
- Create: `packages/core/src/policy/path-policy.ts`
- Create: `packages/core/src/policy/bash-whitelist.ts`
- Create: `packages/core/src/policy/index.ts`
- Test: `packages/core/src/policy/__tests__/path-policy.test.ts`
- Test: `packages/core/src/policy/__tests__/bash-whitelist.test.ts`

- [ ] **Step 1: Install ignore package**

Run: `pnpm --filter @reporead/core add ignore`

- [ ] **Step 2: Write path-policy test**

```ts
// packages/core/src/policy/__tests__/path-policy.test.ts
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
```

- [ ] **Step 3: Write bash-whitelist test**

```ts
// packages/core/src/policy/__tests__/bash-whitelist.test.ts
import { describe, it, expect } from "vitest";
import { validateBashCommand } from "../bash-whitelist.js";

describe("validateBashCommand", () => {
  it("allows whitelisted commands", () => {
    expect(validateBashCommand("wc -l")).toEqual({ allowed: true });
    expect(validateBashCommand("sort file.txt")).toEqual({ allowed: true });
    expect(validateBashCommand("ls -la src/")).toEqual({ allowed: true });
    expect(validateBashCommand("head -20 README.md")).toEqual({ allowed: true });
    expect(validateBashCommand("tail -50 src/index.ts")).toEqual({ allowed: true });
    expect(validateBashCommand("tree -L 2")).toEqual({ allowed: true });
    expect(validateBashCommand("file src/main.ts")).toEqual({ allowed: true });
    expect(validateBashCommand("stat package.json")).toEqual({ allowed: true });
    expect(validateBashCommand("du -sh src/")).toEqual({ allowed: true });
    expect(validateBashCommand("uniq counts.txt")).toEqual({ allowed: true });
  });

  it("allows simple pipes between whitelisted commands", () => {
    expect(validateBashCommand("wc -l | sort -n")).toEqual({ allowed: true });
    expect(validateBashCommand("ls src/ | head -10")).toEqual({ allowed: true });
  });

  it("rejects write commands", () => {
    expect(validateBashCommand("rm -rf /")).toMatchObject({ allowed: false });
    expect(validateBashCommand("mv a b")).toMatchObject({ allowed: false });
    expect(validateBashCommand("cp a b")).toMatchObject({ allowed: false });
    expect(validateBashCommand("chmod 777 file")).toMatchObject({ allowed: false });
  });

  it("rejects network commands", () => {
    expect(validateBashCommand("curl http://evil.com")).toMatchObject({ allowed: false });
    expect(validateBashCommand("wget http://evil.com")).toMatchObject({ allowed: false });
  });

  it("rejects redirects", () => {
    expect(validateBashCommand("echo hello > file.txt")).toMatchObject({ allowed: false });
    expect(validateBashCommand("cat foo >> bar")).toMatchObject({ allowed: false });
  });

  it("rejects subshell escape attempts", () => {
    expect(validateBashCommand("$(rm -rf /)")).toMatchObject({ allowed: false });
    expect(validateBashCommand("`rm -rf /`")).toMatchObject({ allowed: false });
    expect(validateBashCommand("ls; rm -rf /")).toMatchObject({ allowed: false });
    expect(validateBashCommand("ls && rm file")).toMatchObject({ allowed: false });
  });

  it("rejects cat (use Read tool instead)", () => {
    expect(validateBashCommand("cat file.txt")).toMatchObject({ allowed: false });
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `pnpm --filter @reporead/core test -- src/policy`
Expected: FAIL.

- [ ] **Step 5: Implement PathPolicy**

```ts
// packages/core/src/policy/path-policy.ts
import * as fs from "node:fs/promises";
import * as path from "node:path";
import ignore, { type Ignore } from "ignore";

const BUILTIN_IGNORES = [
  "node_modules/",
  ".git/",
  "__pycache__/",
];

export class PathPolicy {
  private readonly repoRoot: string;
  private readonly ig: Ignore;

  private constructor(repoRoot: string, ig: Ignore) {
    this.repoRoot = path.resolve(repoRoot);
    this.ig = ig;
  }

  static async create(repoRoot: string, additionalIgnores: string[] = []): Promise<PathPolicy> {
    const ig = ignore();
    ig.add(BUILTIN_IGNORES);
    ig.add(additionalIgnores);

    try {
      const gitignore = await fs.readFile(path.join(repoRoot, ".gitignore"), "utf-8");
      ig.add(gitignore);
    } catch {
      // No .gitignore — that's fine
    }

    return new PathPolicy(path.resolve(repoRoot), ig);
  }

  isAllowed(filePath: string): boolean {
    // Resolve to absolute, then check it's within repo root
    const resolved = path.resolve(this.repoRoot, filePath);
    if (!resolved.startsWith(this.repoRoot + path.sep) && resolved !== this.repoRoot) {
      return false;
    }

    // Get relative path for ignore check
    const rel = path.relative(this.repoRoot, resolved);
    if (rel.startsWith("..")) return false;
    if (rel === "") return true; // repo root itself

    return !this.ig.ignores(rel);
  }
}
```

- [ ] **Step 6: Implement bash whitelist**

```ts
// packages/core/src/policy/bash-whitelist.ts

const ALLOWED_COMMANDS = new Set([
  "wc", "sort", "uniq", "head", "tail",
  "tree", "file", "stat", "du", "ls",
]);

const FORBIDDEN_PATTERNS = [
  /[>]/,           // redirects
  /[`]/,           // backtick subshell
  /\$\(/,          // $() subshell
  /[;]/,           // command chaining with ;
  /&&/,            // command chaining with &&
  /\|\|/,          // command chaining with ||
];

const FORBIDDEN_COMMANDS = new Set([
  "rm", "mv", "cp", "chmod", "chown", "kill", "sudo",
  "curl", "wget", "cat", "dd", "mkfs", "mount",
  "npm", "npx", "yarn", "pnpm", "pip", "cargo",
  "python", "python3", "node", "ruby", "perl",
  "bash", "sh", "zsh",
]);

export type BashValidationResult = {
  allowed: boolean;
  reason?: string;
};

export function validateBashCommand(command: string): BashValidationResult {
  const trimmed = command.trim();

  // Check forbidden patterns first
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { allowed: false, reason: `Forbidden pattern: ${pattern.source}` };
    }
  }

  // Split by pipes (only | is allowed, not || which was caught above)
  const segments = trimmed.split("|").map((s) => s.trim());

  for (const segment of segments) {
    const parts = segment.split(/\s+/);
    const cmd = parts[0];

    if (!cmd) {
      return { allowed: false, reason: "Empty command segment" };
    }

    if (FORBIDDEN_COMMANDS.has(cmd)) {
      return { allowed: false, reason: `Forbidden command: ${cmd}` };
    }

    if (!ALLOWED_COMMANDS.has(cmd)) {
      return { allowed: false, reason: `Command not in whitelist: ${cmd}` };
    }
  }

  return { allowed: true };
}
```

- [ ] **Step 7: Create policy/index.ts**

```ts
// packages/core/src/policy/index.ts
export { PathPolicy } from "./path-policy.js";
export { validateBashCommand } from "./bash-whitelist.js";
export type { BashValidationResult } from "./bash-whitelist.js";
```

- [ ] **Step 8: Update core index.ts**

Add:
```ts
export { PathPolicy, validateBashCommand } from "./policy/index.js";
```

- [ ] **Step 9: Run tests**

Run: `pnpm --filter @reporead/core test -- src/policy`
Expected: PASS — all path-policy (6) + bash-whitelist (7) = 13 tests pass.

- [ ] **Step 10: Commit**

```bash
git add packages/core/src/policy/ packages/core/src/index.ts packages/core/package.json pnpm-lock.yaml
git commit -m "feat(B031): path policy and bash whitelist

PathPolicy enforces gitignore + repo boundary. Bash whitelist
allows wc/sort/uniq/head/tail/tree/file/stat/du/ls with pipes.
Rejects writes, network, redirects, subshells, cat."
```

---

## Task 3: Read Tool (B032 part 1)

**Files:**
- Create: `packages/core/src/tools/tool-types.ts`
- Create: `packages/core/src/tools/read-tool.ts`
- Test: `packages/core/src/tools/__tests__/read-tool.test.ts`

- [ ] **Step 1: Write test**

```ts
// packages/core/src/tools/__tests__/read-tool.test.ts
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
    // Create a 20-line file
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @reporead/core test -- src/tools/__tests__/read-tool`
Expected: FAIL.

- [ ] **Step 3: Create tool-types.ts**

```ts
// packages/core/src/tools/tool-types.ts
export type ToolResult<T = unknown> = {
  tool: string;
  success: boolean;
  data?: T;
  error?: string;
};
```

- [ ] **Step 4: Implement read-tool**

```ts
// packages/core/src/tools/read-tool.ts
import * as fs from "node:fs/promises";

const DEFAULT_LIMIT = 300;
const MAX_LIMIT = 500;

export type ReadResult = {
  success: boolean;
  content: string;
  totalLines: number;
  linesReturned: number;
  offset: number;
  truncated: boolean;
  error?: string;
};

export type ReadOptions = {
  offset?: number;
  limit?: number;
};

export async function readFile(
  filePath: string,
  options: ReadOptions = {},
): Promise<ReadResult> {
  const offset = Math.max(0, options.offset ?? 0);
  const requestedLimit = options.limit ?? DEFAULT_LIMIT;
  const limit = Math.min(requestedLimit, MAX_LIMIT);

  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf-8");
  } catch (err) {
    return {
      success: false,
      content: "",
      totalLines: 0,
      linesReturned: 0,
      offset,
      truncated: false,
      error: `Failed to read file: ${(err as Error).message}`,
    };
  }

  const allLines = raw.split("\n");
  const totalLines = allLines.length;
  const sliced = allLines.slice(offset, offset + limit);
  const truncated = requestedLimit > MAX_LIMIT || (offset + limit < totalLines && requestedLimit === limit);

  // Add line numbers (1-indexed)
  const numbered = sliced.map((line, i) => `${offset + i + 1}: ${line}`);

  return {
    success: true,
    content: numbered.join("\n"),
    totalLines,
    linesReturned: sliced.length,
    offset,
    truncated: requestedLimit > MAX_LIMIT,
  };
}
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @reporead/core test -- src/tools/__tests__/read-tool`
Expected: PASS — all 4 tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/tools/
git commit -m "feat(B032): read tool with windowed line-numbered output

Default 300 lines, max 500. Supports offset+limit.
Returns line-numbered content with truncation flag."
```

---

## Task 4: Grep and Find Tools (B032 part 2)

**Files:**
- Create: `packages/core/src/tools/grep-tool.ts`
- Create: `packages/core/src/tools/find-tool.ts`
- Test: `packages/core/src/tools/__tests__/grep-tool.test.ts`
- Test: `packages/core/src/tools/__tests__/find-tool.test.ts`

- [ ] **Step 1: Install glob and @vscode/ripgrep**

Run: `pnpm --filter @reporead/core add glob @vscode/ripgrep && pnpm --filter @reporead/core add -D @types/glob`

- [ ] **Step 2: Write grep-tool test**

```ts
// packages/core/src/tools/__tests__/grep-tool.test.ts
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
```

- [ ] **Step 3: Write find-tool test**

```ts
// packages/core/src/tools/__tests__/find-tool.test.ts
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
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `pnpm --filter @reporead/core test -- src/tools`
Expected: FAIL.

- [ ] **Step 5: Implement grep-tool**

```ts
// packages/core/src/tools/grep-tool.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as path from "node:path";

const execFileAsync = promisify(execFile);

export type GrepMatch = {
  file: string;
  line: number;
  content: string;
};

export type GrepResult = {
  success: boolean;
  matches: GrepMatch[];
  error?: string;
};

export type GrepOptions = {
  maxResults?: number;
  glob?: string;
  caseSensitive?: boolean;
};

function getRgPath(): string {
  try {
    // @vscode/ripgrep provides a bundled binary
    const rgModule = require.resolve("@vscode/ripgrep");
    const rgDir = path.dirname(rgModule);
    return path.join(rgDir, "bin", "rg");
  } catch {
    return "rg"; // fallback to system rg
  }
}

export async function grepSearch(
  cwd: string,
  pattern: string,
  options: GrepOptions = {},
): Promise<GrepResult> {
  const maxResults = options.maxResults ?? 50;
  const args = [
    "--json",
    "--max-count", String(maxResults),
    "--no-heading",
  ];

  if (!options.caseSensitive) {
    args.push("--smart-case");
  }

  if (options.glob) {
    args.push("--glob", options.glob);
  }

  args.push("--", pattern, ".");

  try {
    const { stdout } = await execFileAsync(getRgPath(), args, {
      cwd,
      maxBuffer: 10 * 1024 * 1024,
    });

    const matches: GrepMatch[] = [];
    for (const line of stdout.split("\n")) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line);
        if (parsed.type === "match") {
          const data = parsed.data;
          matches.push({
            file: data.path.text,
            line: data.line_number,
            content: data.lines.text.trimEnd(),
          });
        }
      } catch {
        // skip non-json lines
      }
    }

    return { success: true, matches: matches.slice(0, maxResults) };
  } catch (err) {
    const error = err as { code?: number; stdout?: string; stderr?: string };
    // rg exits with code 1 when no matches found — that's not an error
    if (error.code === 1) {
      return { success: true, matches: [] };
    }
    return {
      success: false,
      matches: [],
      error: `Grep failed: ${error.stderr ?? String(err)}`,
    };
  }
}
```

- [ ] **Step 6: Implement find-tool**

```ts
// packages/core/src/tools/find-tool.ts
import { glob } from "glob";
import * as path from "node:path";

export type FindResult = {
  success: boolean;
  files: string[];
  error?: string;
};

export type FindOptions = {
  maxResults?: number;
  ignore?: string[];
};

const DEFAULT_IGNORE = [
  "node_modules/**", ".git/**", "dist/**", "build/**",
  ".next/**", "coverage/**", "__pycache__/**", ".reporead/**",
  "target/**", "vendor/**", ".venv/**",
];

export async function findFiles(
  cwd: string,
  pattern: string,
  options: FindOptions = {},
): Promise<FindResult> {
  const maxResults = options.maxResults ?? 200;
  const ignorePatterns = options.ignore ?? DEFAULT_IGNORE;

  try {
    const matches = await glob(pattern, {
      cwd,
      ignore: ignorePatterns,
      nodir: true,
      maxDepth: 10,
    });

    const limited = matches.slice(0, maxResults).map((f) => path.normalize(f));

    return { success: true, files: limited };
  } catch (err) {
    return {
      success: false,
      files: [],
      error: `Find failed: ${(err as Error).message}`,
    };
  }
}
```

- [ ] **Step 7: Run tests**

Run: `pnpm --filter @reporead/core test -- src/tools`
Expected: PASS — read (4) + grep (4) + find (4) = 12 tests.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/tools/ packages/core/package.json pnpm-lock.yaml
git commit -m "feat(B032): grep and find tools

Grep wraps @vscode/ripgrep with JSON output parsing.
Find wraps glob with default ignore patterns.
Both return structured results with file paths."
```

---

## Task 5: Git and Bash Tools (B032 part 3)

**Files:**
- Create: `packages/core/src/tools/git-tool.ts`
- Create: `packages/core/src/tools/bash-tool.ts`
- Test: `packages/core/src/tools/__tests__/git-tool.test.ts`
- Test: `packages/core/src/tools/__tests__/bash-tool.test.ts`

- [ ] **Step 1: Write git-tool test**

```ts
// packages/core/src/tools/__tests__/git-tool.test.ts
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
```

- [ ] **Step 2: Write bash-tool test**

```ts
// packages/core/src/tools/__tests__/bash-tool.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { execBash } from "../bash-tool.js";

describe("execBash", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "reporead-bash-"));
    await fs.writeFile(path.join(tmpDir, "a.txt"), "line1\nline2\nline3");
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @reporead/core test -- src/tools/__tests__/git-tool src/tools/__tests__/bash-tool`
Expected: FAIL.

- [ ] **Step 4: Implement git-tool**

```ts
// packages/core/src/tools/git-tool.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type GitLogEntry = {
  hash: string;
  author: string;
  date: string;
  message: string;
};

export type GitLogResult = {
  success: boolean;
  entries: GitLogEntry[];
  error?: string;
};

export type GitContentResult = {
  success: boolean;
  content: string;
  error?: string;
};

export async function gitLog(
  cwd: string,
  options: { maxCount?: number; file?: string } = {},
): Promise<GitLogResult> {
  const args = [
    "log",
    `--max-count=${options.maxCount ?? 20}`,
    "--format=%H%n%an%n%ai%n%s%n---",
  ];
  if (options.file) args.push("--", options.file);

  try {
    const { stdout } = await execFileAsync("git", args, { cwd });
    const entries: GitLogEntry[] = [];
    const blocks = stdout.split("---\n").filter((b) => b.trim());

    for (const block of blocks) {
      const lines = block.trim().split("\n");
      if (lines.length >= 4) {
        entries.push({
          hash: lines[0],
          author: lines[1],
          date: lines[2],
          message: lines[3],
        });
      }
    }

    return { success: true, entries };
  } catch (err) {
    return { success: false, entries: [], error: String(err) };
  }
}

export async function gitShow(
  cwd: string,
  ref: string,
): Promise<GitContentResult> {
  try {
    const { stdout } = await execFileAsync("git", ["show", "--stat", ref], {
      cwd,
      maxBuffer: 5 * 1024 * 1024,
    });
    return { success: true, content: stdout };
  } catch (err) {
    return { success: false, content: "", error: String(err) };
  }
}

export async function gitDiff(
  cwd: string,
  ref?: string,
): Promise<GitContentResult> {
  const args = ref ? ["diff", ref] : ["diff"];
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd,
      maxBuffer: 5 * 1024 * 1024,
    });
    return { success: true, content: stdout };
  } catch (err) {
    return { success: false, content: "", error: String(err) };
  }
}
```

- [ ] **Step 5: Implement bash-tool**

```ts
// packages/core/src/tools/bash-tool.ts
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { validateBashCommand } from "../policy/bash-whitelist.js";

const execAsync = promisify(exec);

const BASH_TIMEOUT = 30_000; // 30 seconds

export type BashResult = {
  success: boolean;
  output: string;
  error?: string;
};

export async function execBash(
  cwd: string,
  command: string,
): Promise<BashResult> {
  const validation = validateBashCommand(command);
  if (!validation.allowed) {
    return {
      success: false,
      output: "",
      error: `Command rejected: ${validation.reason}`,
    };
  }

  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      timeout: BASH_TIMEOUT,
      maxBuffer: 5 * 1024 * 1024,
    });
    return {
      success: true,
      output: stdout + (stderr ? `\n[stderr]: ${stderr}` : ""),
    };
  } catch (err) {
    const error = err as { stdout?: string; stderr?: string; message?: string };
    return {
      success: false,
      output: error.stdout ?? "",
      error: error.stderr ?? error.message ?? String(err),
    };
  }
}
```

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @reporead/core test -- src/tools`
Expected: PASS — all tool tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/tools/
git commit -m "feat(B032): git and bash tools

Git tool wraps log/show/diff with structured output.
Bash tool validates against whitelist before execution,
30s timeout, rejects writes/network/redirects."
```

---

## Task 6: Tool Index and Stubs (B032 finish)

**Files:**
- Create: `packages/core/src/tools/page-read-tool.ts`
- Create: `packages/core/src/tools/citation-open-tool.ts`
- Create: `packages/core/src/tools/index.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Create PageRead stub**

```ts
// packages/core/src/tools/page-read-tool.ts
import type { StorageAdapter } from "../storage/storage-adapter.js";
import type { PageMeta } from "../types/generation.js";

export type PageReadResult = {
  success: boolean;
  markdown?: string;
  meta?: PageMeta;
  error?: string;
};

/**
 * Read a published page's Markdown and metadata.
 * Stub for M3 — will be fully implemented in M4 when pages exist.
 */
export async function pageRead(
  storage: StorageAdapter,
  projectSlug: string,
  versionId: string,
  pageSlug: string,
): Promise<PageReadResult> {
  const mdPath = storage.paths.versionPageMd(projectSlug, versionId, pageSlug);
  const metaPath = storage.paths.versionPageMeta(projectSlug, versionId, pageSlug);

  const markdown = await storage.readJson<string>(mdPath);
  const meta = await storage.readJson<PageMeta>(metaPath);

  if (!markdown && !meta) {
    return { success: false, error: `Page "${pageSlug}" not found in version ${versionId}` };
  }

  return {
    success: true,
    markdown: typeof markdown === "string" ? markdown : undefined,
    meta: meta ?? undefined,
  };
}
```

- [ ] **Step 2: Create CitationOpen stub**

```ts
// packages/core/src/tools/citation-open-tool.ts
import type { CitationRecord } from "../types/generation.js";
import { readFile } from "./read-tool.js";

export type CitationOpenResult = {
  success: boolean;
  citation: CitationRecord;
  content?: string;
  error?: string;
};

/**
 * Resolve a citation to its source content.
 * For M3, only file citations are supported.
 * Page and commit citations will be added in M4.
 */
export async function citationOpen(
  repoRoot: string,
  citation: CitationRecord,
): Promise<CitationOpenResult> {
  if (citation.kind === "file") {
    const locator = citation.locator; // e.g., "L10-L20"
    let offset = 0;
    let limit = 300;

    if (locator) {
      const match = locator.match(/^L(\d+)(?:-L(\d+))?$/);
      if (match) {
        offset = parseInt(match[1], 10) - 1; // 0-indexed
        const endLine = match[2] ? parseInt(match[2], 10) : offset + 50;
        limit = endLine - offset;
      }
    }

    const filePath = `${repoRoot}/${citation.target}`;
    const result = await readFile(filePath, { offset, limit });

    return {
      success: result.success,
      citation,
      content: result.content,
      error: result.error,
    };
  }

  // Page and commit citations — M4
  return {
    success: false,
    citation,
    error: `Citation kind "${citation.kind}" not yet supported in M3`,
  };
}
```

- [ ] **Step 3: Create tools/index.ts**

```ts
// packages/core/src/tools/index.ts
export type { ToolResult } from "./tool-types.js";
export { readFile } from "./read-tool.js";
export type { ReadResult, ReadOptions } from "./read-tool.js";
export { grepSearch } from "./grep-tool.js";
export type { GrepMatch, GrepResult, GrepOptions } from "./grep-tool.js";
export { findFiles } from "./find-tool.js";
export type { FindResult, FindOptions } from "./find-tool.js";
export { gitLog, gitShow, gitDiff } from "./git-tool.js";
export type { GitLogEntry, GitLogResult, GitContentResult } from "./git-tool.js";
export { execBash } from "./bash-tool.js";
export type { BashResult } from "./bash-tool.js";
export { pageRead } from "./page-read-tool.js";
export type { PageReadResult } from "./page-read-tool.js";
export { citationOpen } from "./citation-open-tool.js";
export type { CitationOpenResult } from "./citation-open-tool.js";
```

- [ ] **Step 4: Update core index.ts**

Add:
```ts
export {
  readFile, grepSearch, findFiles,
  gitLog, gitShow, gitDiff,
  execBash, pageRead, citationOpen,
} from "./tools/index.js";
```

- [ ] **Step 5: Run all tests**

Run: `pnpm --filter @reporead/core test`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/tools/ packages/core/src/index.ts
git commit -m "feat(B032): tool index with PageRead and CitationOpen stubs

Complete tool layer: Read, Grep, Find, Git, Bash (active),
PageRead and CitationOpen (stubs for M4). All exported from tools/."
```

---

## Task 7: Catalog Prompt Builder (B033 part 1)

**Files:**
- Create: `packages/core/src/catalog/catalog-prompt.ts`
- Test: `packages/core/src/catalog/__tests__/catalog-prompt.test.ts`

- [ ] **Step 1: Write test**

```ts
// packages/core/src/catalog/__tests__/catalog-prompt.test.ts
import { describe, it, expect } from "vitest";
import { buildCatalogSystemPrompt, buildCatalogUserPrompt } from "../catalog-prompt.js";
import type { RepoProfile } from "../../types/project.js";

const mockProfile: RepoProfile = {
  projectSlug: "test-project",
  repoRoot: "/tmp/repo",
  repoName: "test-project",
  branch: "main",
  commitHash: "abc123",
  languages: ["TypeScript", "JavaScript"],
  frameworks: ["Next.js"],
  packageManagers: ["pnpm"],
  entryFiles: ["src/index.ts"],
  importantDirs: ["src", "lib"],
  ignoredPaths: ["node_modules", ".git"],
  sourceFileCount: 42,
  docFileCount: 5,
  treeSummary: "src/\n  index.ts\n  utils.ts\nlib/\n  core.ts",
  architectureHints: ["monorepo"],
};

describe("buildCatalogSystemPrompt", () => {
  it("includes role definition", () => {
    const prompt = buildCatalogSystemPrompt();
    expect(prompt).toContain("technical architect");
    expect(prompt).toContain("reading order");
  });

  it("includes output format instructions", () => {
    const prompt = buildCatalogSystemPrompt();
    expect(prompt).toContain("wiki.json");
    expect(prompt).toContain("reading_order");
  });

  it("includes page limit", () => {
    const prompt = buildCatalogSystemPrompt();
    expect(prompt).toContain("50");
  });
});

describe("buildCatalogUserPrompt", () => {
  it("includes repo profile data", () => {
    const prompt = buildCatalogUserPrompt(mockProfile, "en");
    expect(prompt).toContain("test-project");
    expect(prompt).toContain("TypeScript");
    expect(prompt).toContain("Next.js");
    expect(prompt).toContain("src/index.ts");
  });

  it("includes tree summary", () => {
    const prompt = buildCatalogUserPrompt(mockProfile, "en");
    expect(prompt).toContain("src/");
    expect(prompt).toContain("index.ts");
  });

  it("includes language instruction", () => {
    const zhPrompt = buildCatalogUserPrompt(mockProfile, "zh");
    expect(zhPrompt).toContain("Chinese");

    const enPrompt = buildCatalogUserPrompt(mockProfile, "en");
    expect(enPrompt).toContain("English");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @reporead/core test -- src/catalog`
Expected: FAIL.

- [ ] **Step 3: Implement catalog prompt builder**

```ts
// packages/core/src/catalog/catalog-prompt.ts
import type { RepoProfile } from "../types/project.js";

const LANGUAGE_NAMES: Record<string, string> = {
  zh: "Chinese",
  en: "English",
  ja: "Japanese",
  ko: "Korean",
  fr: "French",
  de: "German",
  es: "Spanish",
};

export function buildCatalogSystemPrompt(): string {
  return `You are a senior technical architect and documentation planner. Your task is to analyze a code repository and produce a structured reading order for generating a technical wiki.

## Your Goal

Produce a \`wiki.json\` document that defines the strict reading order for a set of wiki pages about this repository. This is NOT a loose topic list — it is a carefully ordered sequence that a reader should follow to understand the codebase from first principles.

## Analysis Framework

1. **Why does this project exist?** Understand the core purpose and value proposition.
2. **What does it contain?** Identify the key modules, their responsibilities, and interactions.
3. **Who is the audience?** Consider developers onboarding to the project, tech leads reviewing architecture, and contributors.
4. **How should it be presented?** Structure pages in a logical reading order — from overview to details.

## Tool Usage

Use the provided tools to explore the repository:
- Use \`grep\` to find key symbols, patterns, and entry points.
- Use \`find\` to discover file structure and important directories.
- Use \`read\` to examine key files (entry points, configs, core modules).
- Use \`git_log\` to understand recent changes and project evolution.
- Do NOT read every file. Be selective — focus on understanding architecture and key modules.

## Output Format

When you have enough understanding, output a JSON object with this exact structure:

\`\`\`json
{
  "summary": "A 2-3 sentence summary of what this project is and does",
  "reading_order": [
    {
      "slug": "kebab-case-url-friendly-name",
      "title": "Human-readable page title",
      "rationale": "Why this page exists and what the reader will learn",
      "covered_files": ["src/file1.ts", "src/file2.ts"]
    }
  ]
}
\`\`\`

## Rules

1. **Page count**: Minimum 6, maximum 50. Adjust based on repository complexity.
2. **Reading order matters**: Page N should build on knowledge from pages 1..N-1.
3. **Every page must cover real files**: \`covered_files\` must list actual files in the repository.
4. **No catch-all pages**: Do not create pages like "Other Details" or "Miscellaneous".
5. **Slug format**: kebab-case, URL-friendly, unique across all pages.
6. **First page**: Should always be a project overview (what it is, why it exists).
7. **Last pages**: Can cover advanced topics, deployment, or extension points.
8. Output ONLY the JSON object. No markdown fences, no explanation before or after.`;
}

export function buildCatalogUserPrompt(
  profile: RepoProfile,
  language: string,
): string {
  const langName = LANGUAGE_NAMES[language] ?? language;

  return `Analyze the following repository and produce a wiki.json reading order.

## Repository Information

- **Name**: ${profile.repoName}
- **Languages**: ${profile.languages.join(", ") || "Unknown"}
- **Frameworks**: ${profile.frameworks.join(", ") || "None detected"}
- **Package Managers**: ${profile.packageManagers.join(", ") || "None detected"}
- **Entry Files**: ${profile.entryFiles.join(", ") || "None detected"}
- **Important Directories**: ${profile.importantDirs.join(", ") || "None detected"}
- **Source Files**: ${profile.sourceFileCount}
- **Documentation Files**: ${profile.docFileCount}
- **Architecture Hints**: ${profile.architectureHints.join(", ") || "None"}
- **Branch**: ${profile.branch}

## Directory Structure (top levels)

\`\`\`
${profile.treeSummary}
\`\`\`

## Output Language

Write all titles, summaries, and rationales in **${langName}**.

## Instructions

1. Use the tools to explore the repository structure, read key files, and understand the architecture.
2. Based on your analysis, produce a wiki.json with a logical reading order.
3. Target ${suggestPageCount(profile)} pages (adjust based on what you find).
4. Output ONLY the JSON object.`;
}

function suggestPageCount(profile: RepoProfile): string {
  if (profile.sourceFileCount <= 20) return "6-12";
  if (profile.sourceFileCount <= 200) return "12-25";
  return "25-40";
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @reporead/core test -- src/catalog`
Expected: PASS — all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/catalog/
git commit -m "feat(B033): catalog prompt builder

System prompt defines architect role, analysis framework, JSON output
format, and 50-page limit. User prompt injects RepoProfile data,
tree summary, and target language."
```

---

## Task 8: Catalog Planner with LLM (B033 part 2)

**Files:**
- Create: `packages/core/src/catalog/catalog-tools.ts`
- Create: `packages/core/src/catalog/catalog-planner.ts`
- Test: `packages/core/src/catalog/__tests__/catalog-planner.test.ts`

- [ ] **Step 1: Write test (uses mocked AI SDK)**

```ts
// packages/core/src/catalog/__tests__/catalog-planner.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { CatalogPlanner } from "../catalog-planner.js";
import type { RepoProfile } from "../../types/project.js";
import type { WikiJson } from "../../types/generation.js";

// Mock the AI SDK
vi.mock("ai", () => ({
  generateText: vi.fn(),
  tool: vi.fn((def: { execute: Function }) => def),
}));

const mockProfile: RepoProfile = {
  projectSlug: "test",
  repoRoot: "/tmp/repo",
  repoName: "test",
  branch: "main",
  commitHash: "abc",
  languages: ["TypeScript"],
  frameworks: [],
  packageManagers: ["npm"],
  entryFiles: ["src/index.ts"],
  importantDirs: ["src"],
  ignoredPaths: [],
  sourceFileCount: 10,
  docFileCount: 2,
  treeSummary: "src/\n  index.ts",
  architectureHints: [],
};

const validWikiJson: WikiJson = {
  summary: "A test project",
  reading_order: [
    {
      slug: "overview",
      title: "Project Overview",
      rationale: "Understand what the project does",
      covered_files: ["src/index.ts", "README.md"],
    },
    {
      slug: "core-module",
      title: "Core Module",
      rationale: "Deep dive into the main module",
      covered_files: ["src/index.ts"],
    },
  ],
};

describe("CatalogPlanner", () => {
  it("returns parsed WikiJson from LLM output", async () => {
    const { generateText } = await import("ai");
    const mockGenerateText = vi.mocked(generateText);
    mockGenerateText.mockResolvedValueOnce({
      text: JSON.stringify(validWikiJson),
      toolCalls: [],
      toolResults: [],
      finishReason: "stop",
      usage: { promptTokens: 100, completionTokens: 200, totalTokens: 300 },
    } as never);

    const planner = new CatalogPlanner({
      model: {} as never, // mocked, won't be used directly
      language: "en",
    });

    const result = await planner.plan(mockProfile);
    expect(result.success).toBe(true);
    expect(result.wiki!.summary).toBe("A test project");
    expect(result.wiki!.reading_order).toHaveLength(2);
    expect(result.wiki!.reading_order[0].slug).toBe("overview");
  });

  it("returns error when LLM output is invalid JSON", async () => {
    const { generateText } = await import("ai");
    const mockGenerateText = vi.mocked(generateText);
    mockGenerateText.mockResolvedValueOnce({
      text: "This is not JSON",
      toolCalls: [],
      toolResults: [],
      finishReason: "stop",
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    } as never);

    const planner = new CatalogPlanner({
      model: {} as never,
      language: "en",
    });

    const result = await planner.plan(mockProfile);
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @reporead/core test -- src/catalog/__tests__/catalog-planner`
Expected: FAIL.

- [ ] **Step 3: Implement catalog-tools (AI SDK tool definitions)**

```ts
// packages/core/src/catalog/catalog-tools.ts
import { tool } from "ai";
import { z } from "zod/v4";
import { readFile } from "../tools/read-tool.js";
import { grepSearch } from "../tools/grep-tool.js";
import { findFiles } from "../tools/find-tool.js";
import { gitLog } from "../tools/git-tool.js";

export function createCatalogTools(repoRoot: string) {
  return {
    read: tool({
      description: "Read a file with line numbers. Supports offset and limit for large files. Max 500 lines per read.",
      parameters: z.object({
        path: z.string().describe("Relative file path from repo root"),
        offset: z.number().optional().describe("Start line (0-indexed)"),
        limit: z.number().optional().describe("Max lines to return (default 300, max 500)"),
      }),
      execute: async ({ path: filePath, offset, limit }) => {
        const result = await readFile(`${repoRoot}/${filePath}`, { offset, limit });
        if (!result.success) return `Error: ${result.error}`;
        return `File: ${filePath} (${result.totalLines} lines total, showing ${result.linesReturned} from line ${result.offset + 1})\n${result.content}`;
      },
    }),

    grep: tool({
      description: "Search for a pattern across the repository. Returns matching file paths and line content.",
      parameters: z.object({
        pattern: z.string().describe("Search pattern (regex supported)"),
        glob: z.string().optional().describe("File glob filter, e.g. '*.ts'"),
        maxResults: z.number().optional().describe("Maximum matches to return (default 50)"),
      }),
      execute: async ({ pattern, glob: fileGlob, maxResults }) => {
        const result = await grepSearch(repoRoot, pattern, { maxResults, glob: fileGlob });
        if (!result.success) return `Error: ${result.error}`;
        if (result.matches.length === 0) return "No matches found.";
        return result.matches
          .map((m) => `${m.file}:${m.line}: ${m.content}`)
          .join("\n");
      },
    }),

    find: tool({
      description: "Find files matching a glob pattern. Returns relative file paths.",
      parameters: z.object({
        pattern: z.string().describe("Glob pattern, e.g. '**/*.ts' or 'src/**/*.py'"),
        maxResults: z.number().optional().describe("Maximum files to return (default 200)"),
      }),
      execute: async ({ pattern, maxResults }) => {
        const result = await findFiles(repoRoot, pattern, { maxResults });
        if (!result.success) return `Error: ${result.error}`;
        if (result.files.length === 0) return "No files found.";
        return result.files.join("\n");
      },
    }),

    git_log: tool({
      description: "View recent git commits. Returns commit hash, author, date, and message.",
      parameters: z.object({
        maxCount: z.number().optional().describe("Max commits to return (default 20)"),
        file: z.string().optional().describe("Filter by file path"),
      }),
      execute: async ({ maxCount, file }) => {
        const result = await gitLog(repoRoot, { maxCount, file });
        if (!result.success) return `Error: ${result.error}`;
        return result.entries
          .map((e) => `${e.hash.slice(0, 8)} ${e.date} ${e.author}: ${e.message}`)
          .join("\n");
      },
    }),
  };
}
```

- [ ] **Step 4: Implement catalog-planner**

```ts
// packages/core/src/catalog/catalog-planner.ts
import { generateText } from "ai";
import type { LanguageModelV1 } from "ai";
import type { RepoProfile } from "../types/project.js";
import type { WikiJson } from "../types/generation.js";
import { buildCatalogSystemPrompt, buildCatalogUserPrompt } from "./catalog-prompt.js";
import { createCatalogTools } from "./catalog-tools.js";

export type CatalogPlannerOptions = {
  model: LanguageModelV1;
  language: string;
  maxSteps?: number;
};

export type CatalogPlanResult = {
  success: boolean;
  wiki?: WikiJson;
  error?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
};

export class CatalogPlanner {
  private readonly model: LanguageModelV1;
  private readonly language: string;
  private readonly maxSteps: number;

  constructor(options: CatalogPlannerOptions) {
    this.model = options.model;
    this.language = options.language;
    this.maxSteps = options.maxSteps ?? 20;
  }

  async plan(profile: RepoProfile): Promise<CatalogPlanResult> {
    const systemPrompt = buildCatalogSystemPrompt();
    const userPrompt = buildCatalogUserPrompt(profile, this.language);
    const tools = createCatalogTools(profile.repoRoot);

    try {
      const result = await generateText({
        model: this.model,
        system: systemPrompt,
        prompt: userPrompt,
        tools,
        maxSteps: this.maxSteps,
      });

      const wiki = this.parseWikiJson(result.text);

      return {
        success: true,
        wiki,
        usage: result.usage
          ? {
              promptTokens: result.usage.promptTokens,
              completionTokens: result.usage.completionTokens,
              totalTokens: result.usage.promptTokens + result.usage.completionTokens,
            }
          : undefined,
      };
    } catch (err) {
      return {
        success: false,
        error: `Catalog planning failed: ${(err as Error).message}`,
      };
    }
  }

  private parseWikiJson(text: string): WikiJson {
    // Try to extract JSON from the text (LLM may wrap it in markdown fences)
    let jsonStr = text.trim();

    // Strip markdown code fences if present
    const fenceMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (fenceMatch) {
      jsonStr = fenceMatch[1].trim();
    }

    const parsed = JSON.parse(jsonStr);

    // Basic shape validation
    if (!parsed.summary || !Array.isArray(parsed.reading_order)) {
      throw new Error("Invalid wiki.json structure: missing summary or reading_order");
    }

    return parsed as WikiJson;
  }
}
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @reporead/core test -- src/catalog/__tests__/catalog-planner`
Expected: PASS — both tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/catalog/
git commit -m "feat(B033): catalog planner with LLM tool-calling loop

CatalogPlanner uses Vercel AI SDK generateText with tools
(read, grep, find, git_log) to let the LLM explore the repo
and produce a structured wiki.json reading order."
```

---

## Task 9: Catalog Persister (B034)

**Files:**
- Create: `packages/core/src/catalog/catalog-persister.ts`
- Test: `packages/core/src/catalog/__tests__/catalog-persister.test.ts`

- [ ] **Step 1: Write test**

```ts
// packages/core/src/catalog/__tests__/catalog-persister.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { persistCatalog } from "../catalog-persister.js";
import { StorageAdapter } from "../../storage/storage-adapter.js";
import type { WikiJson } from "../../types/generation.js";

describe("persistCatalog", () => {
  let tmpDir: string;
  let storage: StorageAdapter;

  const wiki: WikiJson = {
    summary: "A test project for unit testing",
    reading_order: [
      { slug: "overview", title: "Overview", rationale: "Start here", covered_files: ["README.md"] },
      { slug: "core", title: "Core Module", rationale: "Main logic", covered_files: ["src/index.ts"] },
    ],
  };

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "reporead-persist-"));
    storage = new StorageAdapter(tmpDir);
    await storage.initialize();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("writes wiki.json to draft directory", async () => {
    await persistCatalog(storage, "proj", "job-1", "v1", wiki);
    const filePath = storage.paths.draftWikiJson("proj", "job-1", "v1");
    const content = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(content);
    expect(parsed.summary).toBe("A test project for unit testing");
    expect(parsed.reading_order).toHaveLength(2);
  });

  it("reading_order is preserved in order", async () => {
    await persistCatalog(storage, "proj", "job-1", "v1", wiki);
    const filePath = storage.paths.draftWikiJson("proj", "job-1", "v1");
    const parsed = JSON.parse(await fs.readFile(filePath, "utf-8"));
    expect(parsed.reading_order[0].slug).toBe("overview");
    expect(parsed.reading_order[1].slug).toBe("core");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @reporead/core test -- src/catalog/__tests__/catalog-persister`
Expected: FAIL.

- [ ] **Step 3: Implement catalog persister**

```ts
// packages/core/src/catalog/catalog-persister.ts
import type { StorageAdapter } from "../storage/storage-adapter.js";
import type { WikiJson } from "../types/generation.js";

export async function persistCatalog(
  storage: StorageAdapter,
  projectSlug: string,
  jobId: string,
  versionId: string,
  wiki: WikiJson,
): Promise<void> {
  const filePath = storage.paths.draftWikiJson(projectSlug, jobId, versionId);
  await storage.writeJson(filePath, wiki);
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @reporead/core test -- src/catalog/__tests__/catalog-persister`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/catalog/
git commit -m "feat(B034): catalog persister writes wiki.json to draft

Persists WikiJson to .reporead/projects/<slug>/jobs/<jobId>/draft/<versionId>/wiki.json."
```

---

## Task 10: Catalog Validator (B035)

**Files:**
- Create: `packages/core/src/catalog/catalog-validator.ts`
- Test: `packages/core/src/catalog/__tests__/catalog-validator.test.ts`
- Create: `packages/core/src/catalog/index.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write test**

```ts
// packages/core/src/catalog/__tests__/catalog-validator.test.ts
import { describe, it, expect } from "vitest";
import { validateCatalog } from "../catalog-validator.js";
import type { WikiJson } from "../../types/generation.js";

const valid: WikiJson = {
  summary: "A test project",
  reading_order: [
    { slug: "overview", title: "Overview", rationale: "Start", covered_files: ["README.md"] },
    { slug: "core", title: "Core", rationale: "Main", covered_files: ["src/index.ts"] },
  ],
};

describe("validateCatalog", () => {
  it("passes valid wiki.json", () => {
    const result = validateCatalog(valid);
    expect(result.passed).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("fails on missing summary", () => {
    const bad = { ...valid, summary: "" };
    const result = validateCatalog(bad);
    expect(result.passed).toBe(false);
    expect(result.errors.some((e) => e.includes("summary"))).toBe(true);
  });

  it("fails on empty reading_order", () => {
    const bad = { ...valid, reading_order: [] };
    const result = validateCatalog(bad);
    expect(result.passed).toBe(false);
    expect(result.errors.some((e) => e.includes("reading_order"))).toBe(true);
  });

  it("fails when exceeding 50 page limit", () => {
    const pages = Array.from({ length: 51 }, (_, i) => ({
      slug: `page-${i}`,
      title: `Page ${i}`,
      rationale: "test",
      covered_files: ["file.ts"],
    }));
    const big = { summary: "big", reading_order: pages };
    const result = validateCatalog(big);
    expect(result.passed).toBe(false);
    expect(result.errors.some((e) => e.includes("50"))).toBe(true);
  });

  it("fails on duplicate slugs", () => {
    const dup: WikiJson = {
      summary: "test",
      reading_order: [
        { slug: "overview", title: "A", rationale: "R", covered_files: ["a.ts"] },
        { slug: "overview", title: "B", rationale: "R", covered_files: ["b.ts"] },
      ],
    };
    const result = validateCatalog(dup);
    expect(result.passed).toBe(false);
    expect(result.errors.some((e) => e.includes("duplicate"))).toBe(true);
  });

  it("fails on empty slug", () => {
    const bad: WikiJson = {
      summary: "test",
      reading_order: [
        { slug: "", title: "No Slug", rationale: "R", covered_files: ["a.ts"] },
      ],
    };
    const result = validateCatalog(bad);
    expect(result.passed).toBe(false);
  });

  it("warns on pages with no covered_files", () => {
    const noFiles: WikiJson = {
      summary: "test",
      reading_order: [
        { slug: "intro", title: "Intro", rationale: "R", covered_files: [] },
      ],
    };
    const result = validateCatalog(noFiles);
    // Empty covered_files is a warning, not a blocker
    expect(result.warnings.some((w) => w.includes("covered_files"))).toBe(true);
  });

  it("fails on fewer than 2 pages", () => {
    const tiny: WikiJson = {
      summary: "test",
      reading_order: [
        { slug: "only", title: "Only", rationale: "R", covered_files: ["a.ts"] },
      ],
    };
    const result = validateCatalog(tiny);
    expect(result.passed).toBe(false);
    expect(result.errors.some((e) => e.includes("2"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @reporead/core test -- src/catalog/__tests__/catalog-validator`
Expected: FAIL.

- [ ] **Step 3: Implement catalog validator**

```ts
// packages/core/src/catalog/catalog-validator.ts
import type { WikiJson } from "../types/generation.js";
import type { ValidationReport } from "../types/validation.js";

const MAX_PAGES = 50;
const MIN_PAGES = 2;

export function validateCatalog(wiki: WikiJson): ValidationReport {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check summary
  if (!wiki.summary || wiki.summary.trim().length === 0) {
    errors.push("Missing or empty summary");
  }

  // Check reading_order exists and has entries
  if (!wiki.reading_order || !Array.isArray(wiki.reading_order)) {
    errors.push("Missing or invalid reading_order array");
    return { target: "wiki", passed: false, errors, warnings };
  }

  if (wiki.reading_order.length === 0) {
    errors.push("Empty reading_order — at least 2 pages required");
    return { target: "wiki", passed: false, errors, warnings };
  }

  if (wiki.reading_order.length < MIN_PAGES) {
    errors.push(`Too few pages: ${wiki.reading_order.length}, minimum is ${MIN_PAGES}`);
  }

  if (wiki.reading_order.length > MAX_PAGES) {
    errors.push(`Too many pages: ${wiki.reading_order.length}, maximum is ${MAX_PAGES}`);
  }

  // Check individual pages
  const slugs = new Set<string>();
  for (let i = 0; i < wiki.reading_order.length; i++) {
    const page = wiki.reading_order[i];
    const prefix = `Page ${i + 1}`;

    if (!page.slug || page.slug.trim().length === 0) {
      errors.push(`${prefix}: empty slug`);
    } else if (slugs.has(page.slug)) {
      errors.push(`${prefix}: duplicate slug "${page.slug}"`);
    } else {
      slugs.add(page.slug);
    }

    if (!page.title || page.title.trim().length === 0) {
      errors.push(`${prefix} (${page.slug}): empty title`);
    }

    if (!page.covered_files || page.covered_files.length === 0) {
      warnings.push(`${prefix} (${page.slug}): empty covered_files — page may lack evidence basis`);
    }
  }

  return {
    target: "wiki",
    passed: errors.length === 0,
    errors,
    warnings,
  };
}
```

- [ ] **Step 4: Create catalog/index.ts**

```ts
// packages/core/src/catalog/index.ts
export { buildCatalogSystemPrompt, buildCatalogUserPrompt } from "./catalog-prompt.js";
export { createCatalogTools } from "./catalog-tools.js";
export { CatalogPlanner } from "./catalog-planner.js";
export type { CatalogPlannerOptions, CatalogPlanResult } from "./catalog-planner.js";
export { persistCatalog } from "./catalog-persister.js";
export { validateCatalog } from "./catalog-validator.js";
```

- [ ] **Step 5: Update core index.ts**

Add:
```ts
export {
  CatalogPlanner, buildCatalogSystemPrompt, buildCatalogUserPrompt,
  persistCatalog, validateCatalog, createCatalogTools,
} from "./catalog/index.js";
export type { CatalogPlannerOptions, CatalogPlanResult } from "./catalog/index.js";
```

- [ ] **Step 6: Run all tests**

Run: `pnpm --filter @reporead/core test`
Expected: ALL pass.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/catalog/ packages/core/src/index.ts
git commit -m "feat(B035): catalog validator with schema and semantic checks

Validates summary, reading_order count (2-50), unique slugs,
non-empty titles. Warns on empty covered_files."
```

---

## Dependency Graph

```
Task 1 (B030: Repo Profiler)
  └─→ Task 2 (B031: Path Policy + Bash Whitelist)
       └─→ Task 3 (B032: Read Tool)
       │    └─→ Task 4 (B032: Grep + Find)
       │         └─→ Task 5 (B032: Git + Bash)
       │              └─→ Task 6 (B032: Tool Index + Stubs)
       │                   └─→ Task 8 (B033: Catalog Planner with LLM)
       └─→ Task 7 (B033: Catalog Prompt Builder)
            └─→ Task 8 (B033: Catalog Planner with LLM)
                 └─→ Task 9 (B034: Catalog Persister)
                 └─→ Task 10 (B035: Catalog Validator)
```

Tasks 7 and 3-6 can be parallelized. Task 9 and 10 can be parallelized after Task 8.

---

## Notes for Implementer

1. **@vscode/ripgrep**: The `require.resolve("@vscode/ripgrep")` approach in grep-tool.ts may need adjustment depending on ESM resolution. If it fails, fall back to `which rg` or look for the binary in `node_modules/@vscode/ripgrep/bin/rg`.
2. **AI SDK mock in tests**: The catalog-planner test mocks the entire `ai` module. This is the correct approach for unit tests — real LLM calls go in integration/golden tests only.
3. **Catalog prompt**: The prompt text is intentionally verbose. It will be refined through real usage in M3+ golden fixture testing.
4. **glob package**: If the `glob` package causes issues with ESM, consider using `fast-glob` (`fdir` + `picomatch`) as an alternative.
5. **Error codes**: Add `"CATALOG_INVALID"`, `"CATALOG_GENERATION_FAILED"`, `"TOOL_EXECUTION_FAILED"`, `"PATH_REJECTED"` to `ErrorCode` in `errors.ts` when they're needed.
