import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import * as path from "node:path";

const execFileAsync = promisify(execFile);

export type GrepMatch = { file: string; line: number; content: string };
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
    const esmRequire = createRequire(import.meta.url);
    const rgModule = esmRequire.resolve("@vscode/ripgrep");
    // rgModule points to <pkg>/lib/index.js, binary is at <pkg>/bin/rg
    const pkgDir = path.dirname(path.dirname(rgModule));
    return path.join(pkgDir, "bin", "rg");
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
  const args = ["--json", "--max-count", String(maxResults), "--no-heading"];

  if (!options.caseSensitive) args.push("--smart-case");
  if (options.glob) args.push("--glob", options.glob);
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
          matches.push({
            file: parsed.data.path.text,
            line: parsed.data.line_number,
            content: parsed.data.lines.text.trimEnd(),
          });
        }
      } catch {
        /* skip non-JSON lines */
      }
    }
    return { success: true, matches: matches.slice(0, maxResults) };
  } catch (err) {
    const error = err as { code?: number; stderr?: string };
    // ripgrep exit code 1 means no matches found
    if (error.code === 1) return { success: true, matches: [] };
    return {
      success: false,
      matches: [],
      error: `Grep failed: ${error.stderr ?? String(err)}`,
    };
  }
}
