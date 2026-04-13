/**
 * Directory tree tool — returns a tree-style text representation of a directory.
 * Equivalent to Zread's `get_dir_structure`.
 */
import { exec } from "node:child_process";
import { promisify } from "node:util";
import * as path from "node:path";

const execAsync = promisify(exec);

export type DirStructureResult = {
  success: boolean;
  tree: string;
  error?: string;
};

/** Escape a string for safe use inside single-quoted shell arguments. */
function shellEscape(s: string): string {
  return s.replace(/'/g, "'\\''");
}

export async function getDirStructure(
  repoRoot: string,
  dirPath: string = ".",
  maxDepth: number = 3,
): Promise<DirStructureResult> {
  // Validate: resolved target must be within repoRoot (prevent path traversal)
  const resolved = path.resolve(repoRoot, dirPath);
  if (!resolved.startsWith(path.resolve(repoRoot))) {
    return { success: false, tree: "", error: "Path is outside repository root" };
  }

  // Clamp maxDepth to a sane range
  const depth = Math.max(1, Math.min(maxDepth, 10));

  // Use find + sort to build a tree, filtering common noise directories
  const excludes = [
    "node_modules", ".git", "__pycache__", ".egg-info", "dist", "build",
    ".next", ".nuxt", "vendor", ".venv", "venv", ".tox", "coverage",
    ".mypy_cache", ".pytest_cache", ".ruff_cache",
  ].map((d) => `-path '*/${d}' -prune`).join(" -o ");

  const target = resolved;
  const cmd = `find '${shellEscape(target)}' -maxdepth ${depth} \\( ${excludes} \\) -o -print | sort`;

  try {
    const { stdout } = await execAsync(cmd, {
      cwd: repoRoot,
      timeout: 15_000,
      maxBuffer: 2 * 1024 * 1024,
    });

    // Convert flat path list to tree-style output
    const lines = stdout.trim().split("\n").filter(Boolean);
    const basePath = target.replace(/\/$/, "");
    const treeLines: string[] = [];

    for (const line of lines) {
      const rel = line.startsWith(basePath) ? line.slice(basePath.length) : line;
      if (!rel || rel === "/") {
        treeLines.push(dirPath === "." ? "." : dirPath);
        continue;
      }
      const parts = rel.replace(/^\//, "").split("/");
      const depth = parts.length - 1;
      const indent = "│   ".repeat(depth);
      const name = parts[parts.length - 1];
      treeLines.push(`${indent}├── ${name}`);
    }

    // Cap output at 500 lines
    const maxLines = 500;
    const truncated = treeLines.length > maxLines;
    const output = treeLines.slice(0, maxLines).join("\n");

    return {
      success: true,
      tree: truncated
        ? `${output}\n... (${treeLines.length - maxLines} more entries truncated)`
        : output,
    };
  } catch (err) {
    const error = err as { message?: string };
    return { success: false, tree: "", error: error.message ?? String(err) };
  }
}
