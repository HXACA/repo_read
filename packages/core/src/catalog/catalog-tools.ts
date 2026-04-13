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
import { jsonSchema } from "ai";
import { readFile } from "../tools/read-tool.js";
import { grepSearch } from "../tools/grep-tool.js";
import { findFiles } from "../tools/find-tool.js";
import { gitLog } from "../tools/git-tool.js";
import { getDirStructure } from "../tools/dir-structure-tool.js";
import { execBash } from "../tools/bash-tool.js";

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
        const result = await getDirStructure(repoRoot, dir_path ?? ".", max_depth ?? 3);
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
        const result = await readFile(`${repoRoot}/${filePath}`, { offset, limit });
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
