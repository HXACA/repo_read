import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { RepoProfile } from "../types/project.js";

const execFileAsync = promisify(execFile);

/* ---------- constants ---------- */

const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "out",
  "__pycache__",
  ".venv",
  "venv",
  ".next",
  ".cache",
  "coverage",
  ".turbo",
  ".nx",
  "target",        // Rust/Cargo, Java/Maven
  "vendor",        // Go, PHP
]);

const SOURCE_EXTS = new Map<string, string>([
  [".ts", "TypeScript"],
  [".tsx", "TypeScript"],
  [".js", "JavaScript"],
  [".jsx", "JavaScript"],
  [".mjs", "JavaScript"],
  [".cjs", "JavaScript"],
  [".py", "Python"],
  [".rs", "Rust"],
  [".go", "Go"],
  [".java", "Java"],
  [".kt", "Kotlin"],
  [".swift", "Swift"],
  [".rb", "Ruby"],
  [".php", "PHP"],
  [".c", "C"],
  [".h", "C"],
  [".cpp", "C++"],
  [".hpp", "C++"],
  [".cs", "C#"],
  [".scala", "Scala"],
  [".ex", "Elixir"],
  [".exs", "Elixir"],
  [".erl", "Erlang"],
  [".zig", "Zig"],
  [".lua", "Lua"],
  [".r", "R"],
  [".R", "R"],
  [".dart", "Dart"],
  [".vue", "Vue"],
  [".svelte", "Svelte"],
]);

const DOC_EXTS = new Set([".md", ".txt", ".rst", ".adoc", ".textile"]);

const FRAMEWORK_CONFIG: Record<string, string> = {
  "next.config.ts": "Next.js",
  "next.config.js": "Next.js",
  "next.config.mjs": "Next.js",
  "nuxt.config.ts": "Nuxt",
  "nuxt.config.js": "Nuxt",
  "angular.json": "Angular",
  "svelte.config.js": "SvelteKit",
  "svelte.config.ts": "SvelteKit",
  "astro.config.mjs": "Astro",
  "astro.config.ts": "Astro",
  "remix.config.js": "Remix",
  "remix.config.ts": "Remix",
  "vite.config.ts": "Vite",
  "vite.config.js": "Vite",
  "webpack.config.js": "Webpack",
  "webpack.config.ts": "Webpack",
  "Cargo.toml": "Cargo",
  "go.mod": "Go Modules",
  "Gemfile": "Bundler",
  "composer.json": "Composer",
  "Pipfile": "Pipenv",
  "pyproject.toml": "Python (pyproject)",
  "setup.py": "Python (setuptools)",
  "Dockerfile": "Docker",
  "docker-compose.yml": "Docker Compose",
  "docker-compose.yaml": "Docker Compose",
  "turbo.json": "Turborepo",
};

const PACKAGE_MANAGER_LOCK: Record<string, string> = {
  "package-lock.json": "npm",
  "yarn.lock": "yarn",
  "pnpm-lock.yaml": "pnpm",
  "bun.lockb": "bun",
  "bun.lock": "bun",
};

const IMPORTANT_DIR_NAMES = new Set([
  "src",
  "lib",
  "app",
  "api",
  "cmd",
  "pkg",
  "internal",
  "server",
  "client",
  "components",
  "pages",
  "routes",
  "services",
  "utils",
  "helpers",
  "config",
  "scripts",
  "test",
  "tests",
  "__tests__",
  "spec",
  "e2e",
  "packages",
  "apps",
  "modules",
  "core",
  "common",
  "shared",
  "public",
  "static",
  "assets",
]);

const WELL_KNOWN_ENTRY_FILES = [
  "src/index.ts",
  "src/index.tsx",
  "src/index.js",
  "src/main.ts",
  "src/main.tsx",
  "src/main.js",
  "src/app.ts",
  "src/app.tsx",
  "src/app.js",
  "index.ts",
  "index.js",
  "main.py",
  "app.py",
  "manage.py",
  "main.go",
  "cmd/main.go",
  "src/main.rs",
  "src/lib.rs",
];

/* ---------- helpers ---------- */

interface WalkState {
  languages: Set<string>;
  sourceFileCount: number;
  docFileCount: number;
  importantDirs: Set<string>;
  treeLines: string[];
}

async function walkDir(
  rootDir: string,
  currentDir: string,
  depth: number,
  maxDepth: number,
  state: WalkState,
): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(currentDir, { withFileTypes: true });
  } catch {
    return;
  }

  // Sort for deterministic tree output
  entries.sort((a, b) => a.name.localeCompare(b.name));

  const relDir = path.relative(rootDir, currentDir);

  for (const entry of entries) {
    const name = entry.name;

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(name)) continue;

      const relPath = relDir ? path.join(relDir, name) : name;

      // Tree summary: directories at depth <= 2
      if (depth <= 2) {
        const indent = "  ".repeat(depth);
        state.treeLines.push(`${indent}${name}/`);
      }

      // Important dirs at depth <= 2
      if (depth <= 2 && IMPORTANT_DIR_NAMES.has(name)) {
        state.importantDirs.add(relPath);
      }

      if (depth < maxDepth) {
        await walkDir(rootDir, path.join(currentDir, name), depth + 1, maxDepth, state);
      }
    } else if (entry.isFile()) {
      const ext = path.extname(name);

      // Language detection
      const lang = SOURCE_EXTS.get(ext);
      if (lang) {
        state.languages.add(lang);
        state.sourceFileCount++;
      }

      // Doc file counting
      if (DOC_EXTS.has(ext)) {
        state.docFileCount++;
      }

      // Tree summary: files at depth <= 1
      if (depth <= 1) {
        const indent = "  ".repeat(depth);
        state.treeLines.push(`${indent}${name}`);
      }
    }
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function gitInfo(repoRoot: string): Promise<{ branch: string; commitHash: string }> {
  let branch = "unknown";
  let commitHash = "unknown";

  try {
    const branchResult = await execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: repoRoot,
    });
    branch = branchResult.stdout.trim();
  } catch {
    // not a git repo or git not available
  }

  try {
    const hashResult = await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: repoRoot,
    });
    commitHash = hashResult.stdout.trim();
  } catch {
    // not a git repo or git not available
  }

  return { branch, commitHash };
}

/* ---------- main ---------- */

export async function profileRepo(
  repoRoot: string,
  projectSlug: string,
): Promise<RepoProfile> {
  const rootEntries = await fs.readdir(repoRoot);
  const rootEntrySet = new Set(rootEntries);

  // --- Frameworks ---
  const frameworks: string[] = [];
  const seenFrameworks = new Set<string>();
  for (const [configFile, framework] of Object.entries(FRAMEWORK_CONFIG)) {
    if (rootEntrySet.has(configFile) && !seenFrameworks.has(framework)) {
      frameworks.push(framework);
      seenFrameworks.add(framework);
    }
  }

  // --- Package managers ---
  const packageManagers: string[] = [];
  const seenManagers = new Set<string>();
  for (const [lockFile, manager] of Object.entries(PACKAGE_MANAGER_LOCK)) {
    if (rootEntrySet.has(lockFile) && !seenManagers.has(manager)) {
      packageManagers.push(manager);
      seenManagers.add(manager);
    }
  }
  // Default to npm if package.json present but no lock file detected
  if (rootEntrySet.has("package.json") && packageManagers.length === 0) {
    packageManagers.push("npm");
  }

  // --- Walk directory tree ---
  const state: WalkState = {
    languages: new Set(),
    sourceFileCount: 0,
    docFileCount: 0,
    importantDirs: new Set(),
    treeLines: [],
  };

  await walkDir(repoRoot, repoRoot, 0, 5, state);

  // --- Entry files ---
  const entryFiles: string[] = [];
  for (const candidate of WELL_KNOWN_ENTRY_FILES) {
    if (await fileExists(path.join(repoRoot, candidate))) {
      entryFiles.push(candidate);
    }
  }

  // Also check package.json "main" field for entry hints
  const architectureHints: string[] = [];
  if (rootEntrySet.has("package.json")) {
    try {
      const pkgRaw = await fs.readFile(path.join(repoRoot, "package.json"), "utf-8");
      const pkg = JSON.parse(pkgRaw) as Record<string, unknown>;

      if (pkg.main && typeof pkg.main === "string") {
        architectureHints.push(`main: ${pkg.main}`);
        // If main field points to a file that exists and isn't already in entryFiles
        const mainPath = pkg.main;
        if (!entryFiles.includes(mainPath) && await fileExists(path.join(repoRoot, mainPath))) {
          entryFiles.push(mainPath);
        }
      }

      if (pkg.workspaces) {
        architectureHints.push("monorepo (npm/yarn workspaces)");
      }

      if (pkg.type === "module") {
        architectureHints.push("ESM (type: module)");
      }
    } catch {
      // malformed package.json
    }
  }

  // Check for pnpm workspaces
  if (rootEntrySet.has("pnpm-workspace.yaml")) {
    architectureHints.push("monorepo (pnpm workspaces)");
  }

  // --- Git info ---
  const { branch, commitHash } = await gitInfo(repoRoot);

  // --- Repo name ---
  const repoName = path.basename(repoRoot);

  // --- Tree summary ---
  const treeSummary = state.treeLines.join("\n");

  return {
    projectSlug,
    repoRoot,
    repoName,
    branch,
    commitHash,
    languages: [...state.languages].sort(),
    frameworks,
    packageManagers,
    entryFiles,
    importantDirs: [...state.importantDirs].sort(),
    ignoredPaths: [...SKIP_DIRS],
    sourceFileCount: state.sourceFileCount,
    docFileCount: state.docFileCount,
    treeSummary,
    architectureHints,
  };
}
