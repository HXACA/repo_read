import { glob } from "glob";
import * as path from "node:path";

export type FindResult = {
  success: boolean;
  files: string[];
  error?: string;
};
export type FindOptions = { maxResults?: number; ignore?: string[] };

const DEFAULT_IGNORE = [
  "node_modules/**",
  ".git/**",
  "dist/**",
  "build/**",
  ".next/**",
  "coverage/**",
  "__pycache__/**",
  ".reporead/**",
  "target/**",
  "vendor/**",
  ".venv/**",
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
