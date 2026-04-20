/**
 * AI SDK tool definitions for catalog exploration.
 *
 * Aligned with Zread's tool set:
 * - dir_structure → get_dir_structure (tree-style directory view)
 * - read → view_file_in_detail
 * - grep → search patterns across repo
 * - find → find files by glob
 * - git_log → recent commits
 * - bash → run_bash (read-only shell commands)
 */
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { jsonSchema } from "ai";
import { readFile } from "../tools/read-tool.js";
import { grepSearch } from "../tools/grep-tool.js";
import { findFiles } from "../tools/find-tool.js";
import { gitLog } from "../tools/git-tool.js";
import { getDirStructure } from "../tools/dir-structure-tool.js";
import { execBash } from "../tools/bash-tool.js";

/**
 * Resolve a user-supplied relative path to an absolute path that is
 * provably inside `repoRoot`, following symlinks. Returns `null` when
 * the path escapes the root either via `..` / absolute segments or via
 * symlinks that point outside. This closes a class of exfiltration
 * attacks where a malicious repo plants `docs/secret -> ~/.ssh/id_rsa`:
 * the naive `path.resolve` check would accept `docs/secret` (prefix
 * match) and `fs.readFile` would follow the link out of the checkout.
 */
async function resolveWithinRoot(repoRoot: string, relPath: string): Promise<string | null> {
  const resolvedRoot = await fs.realpath(path.resolve(repoRoot)).catch(() => path.resolve(repoRoot));
  const candidate = path.resolve(resolvedRoot, relPath);

  // Cheap prefix check first (catches `..` escapes even if realpath would
  // have resolved to something inside — here we just haven't resolved yet).
  if (candidate !== resolvedRoot && !candidate.startsWith(resolvedRoot + path.sep)) {
    return null;
  }

  // realpath() resolves symlinks — the true target must still live under
  // the real root. `ENOENT` means the file doesn't exist yet (fine for
  // negative cases); any other error is treated as "can't prove safe".
  try {
    const real = await fs.realpath(candidate);
    if (real !== resolvedRoot && !real.startsWith(resolvedRoot + path.sep)) {
      return null;
    }
    return real;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      // File missing — let the tool itself surface a "not found" error,
      // but only if the parent directory resolves inside the root.
      const parent = path.dirname(candidate);
      try {
        const parentReal = await fs.realpath(parent);
        if (parentReal !== resolvedRoot && !parentReal.startsWith(resolvedRoot + path.sep)) {
          return null;
        }
        return candidate;
      } catch {
        return null;
      }
    }
    return null;
  }
}

export function createCatalogTools(repoRoot: string, options?: { allowBash?: boolean }) {
  const tools: Record<string, unknown> = {
    dir_structure: {
      description:
        "Get directory structure as a tree. Use this first to understand project layout. Supports specifying a subdirectory and max depth.",
      inputSchema: jsonSchema<{ dir_path?: string; max_depth?: number }>({
        type: "object",
        properties: {
          dir_path: { type: "string", description: "Relative directory path (default: '.' for root)" },
          max_depth: { type: "number", description: "Max recursion depth (default: 3)" },
        },
      }),
      execute: async ({ dir_path, max_depth }: { dir_path?: string; max_depth?: number }) => {
        // Same symlink-escape guard as `read`: realpath of the requested
        // dir must stay inside repoRoot so a symlink like
        // `docs/mount -> /etc` can't enumerate system directories.
        const resolved = await resolveWithinRoot(repoRoot, dir_path ?? ".");
        if (!resolved) return "Error: Path is outside repository root";
        const result = await getDirStructure(repoRoot, path.relative(repoRoot, resolved) || ".", max_depth ?? 3);
        if (!result.success) return `Error: ${result.error}`;
        return result.tree;
      },
    },
    read: {
      description:
        "Read a file with line numbers. Supports offset and limit for large files. Max 500 lines per read.",
      inputSchema: jsonSchema<{ path: string; offset?: number; limit?: number }>({
        type: "object",
        properties: {
          path: { type: "string", description: "Relative file path from repo root" },
          offset: { type: "number", description: "Start line (0-indexed)" },
          limit: { type: "number", description: "Max lines to return (default 300, max 500)" },
        },
        required: ["path"],
      }),
      execute: async ({ path: filePath, offset, limit }: { path: string; offset?: number; limit?: number }) => {
        // Path traversal + symlink-escape protection: realpath resolution
        // must still land inside repoRoot.
        const resolved = await resolveWithinRoot(repoRoot, filePath);
        if (!resolved) return "Error: Path is outside repository root";
        const result = await readFile(resolved, { offset, limit });
        if (!result.success) return `Error: ${result.error}`;
        return `File: ${filePath} (${result.totalLines} lines total, showing ${result.linesReturned} from line ${result.offset + 1})\n${result.content}`;
      },
    },
    grep: {
      description:
        "Search for a pattern across the repository. Returns matching file paths and line content.",
      inputSchema: jsonSchema<{ pattern: string; glob?: string; maxResults?: number }>({
        type: "object",
        properties: {
          pattern: { type: "string", description: "Search pattern (regex supported)" },
          glob: { type: "string", description: "File glob filter, e.g. '*.ts'" },
          maxResults: { type: "number", description: "Maximum matches to return (default 50)" },
        },
        required: ["pattern"],
      }),
      execute: async ({ pattern, glob: fileGlob, maxResults }: { pattern: string; glob?: string; maxResults?: number }) => {
        const result = await grepSearch(repoRoot, pattern, { maxResults, glob: fileGlob });
        if (!result.success) return `Error: ${result.error}`;
        if (result.matches.length === 0) return "No matches found.";
        return result.matches
          .map((m) => `${m.file}:${m.line}: ${m.content}`)
          .join("\n");
      },
    },
    find: {
      description: "Find files matching a glob pattern. Returns relative file paths.",
      inputSchema: jsonSchema<{ pattern: string; maxResults?: number }>({
        type: "object",
        properties: {
          pattern: { type: "string", description: "Glob pattern, e.g. '**/*.ts' or 'src/**/*.py'" },
          maxResults: { type: "number", description: "Maximum files to return (default 200)" },
        },
        required: ["pattern"],
      }),
      execute: async ({ pattern, maxResults }: { pattern: string; maxResults?: number }) => {
        const result = await findFiles(repoRoot, pattern, { maxResults });
        if (!result.success) return `Error: ${result.error}`;
        if (result.files.length === 0) return "No files found.";
        return result.files.join("\n");
      },
    },
    git_log: {
      description: "View recent git commits. Returns commit hash, author, date, and message.",
      inputSchema: jsonSchema<{ maxCount?: number; file?: string }>({
        type: "object",
        properties: {
          maxCount: { type: "number", description: "Max commits to return (default 20)" },
          file: { type: "string", description: "Filter by file path" },
        },
      }),
      execute: async ({ maxCount, file }: { maxCount?: number; file?: string }) => {
        const result = await gitLog(repoRoot, { maxCount, file });
        if (!result.success) return `Error: ${result.error}`;
        return result.entries
          .map((e) => `${e.hash.slice(0, 8)} ${e.date} ${e.author}: ${e.message}`)
          .join("\n");
      },
    },
  };

  if (options?.allowBash !== false) {
    tools.bash = {
      description:
        "Run a read-only shell command in the repository. Only informational commands allowed (ls, find, cat, grep, head, tail, wc, git log, git show, etc.). No write/delete/modify commands. Timeout: 30s.",
      inputSchema: jsonSchema<{ command: string }>({
        type: "object",
        properties: {
          command: { type: "string", description: "Shell command to execute" },
        },
        required: ["command"],
      }),
      execute: async ({ command }: { command: string }) => {
        const result = await execBash(repoRoot, command);
        if (!result.success) return `Error: ${result.error}`;
        return result.output;
      },
    };
  }

  return tools;
}
