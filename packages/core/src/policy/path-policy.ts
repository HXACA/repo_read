import * as fs from "node:fs/promises";
import * as path from "node:path";
import ignore, { type Ignore } from "ignore";

const BUILTIN_IGNORES = ["node_modules/", ".git/", "__pycache__/"];

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
    } catch { /* No .gitignore */ }
    return new PathPolicy(path.resolve(repoRoot), ig);
  }

  isAllowed(filePath: string): boolean {
    const resolved = path.resolve(this.repoRoot, filePath);
    if (!resolved.startsWith(this.repoRoot + path.sep) && resolved !== this.repoRoot) {
      return false;
    }
    const rel = path.relative(this.repoRoot, resolved);
    if (rel.startsWith("..")) return false;
    if (rel === "") return true;
    return !this.ig.ignores(rel);
  }
}
