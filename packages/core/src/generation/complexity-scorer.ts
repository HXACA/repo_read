import * as path from "node:path";

export type PageComplexityScore = {
  fileCount: number;
  dirSpread: number;
  crossLanguage: boolean;
  score: number;
};

const LANG_GROUPS: Record<string, string> = {
  ".ts": "js", ".tsx": "js", ".js": "js", ".jsx": "js", ".mjs": "js", ".cjs": "js",
  ".py": "python", ".pyx": "python",
  ".go": "go",
  ".rs": "rust",
  ".java": "java", ".kt": "kotlin",
  ".rb": "ruby",
  ".c": "c", ".cpp": "c", ".h": "c", ".hpp": "c",
  ".swift": "swift",
};

export function computeComplexity(input: { coveredFiles: string[] }): PageComplexityScore {
  const files = input.coveredFiles;
  const fileCount = files.length;
  const dirs = new Set(files.map((f) => path.dirname(f)));
  const dirSpread = dirs.size;
  const langs = new Set<string>();
  for (const f of files) {
    const ext = path.extname(f).toLowerCase();
    const lang = LANG_GROUPS[ext];
    if (lang) langs.add(lang);
  }
  const crossLanguage = langs.size > 1;
  const score = fileCount + dirSpread * 2 + (crossLanguage ? 5 : 0);
  return { fileCount, dirSpread, crossLanguage, score };
}
