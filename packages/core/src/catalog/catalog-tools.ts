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
        return result.matches.map((m) => `${m.file}:${m.line}: ${m.content}`).join("\n");
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
        return result.entries.map((e) => `${e.hash.slice(0, 8)} ${e.date} ${e.author}: ${e.message}`).join("\n");
      },
    }),
  };
}
