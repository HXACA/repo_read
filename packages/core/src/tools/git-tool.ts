import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type GitLogEntry = { hash: string; author: string; date: string; message: string };
export type GitLogResult = { success: boolean; entries: GitLogEntry[]; error?: string };
export type GitContentResult = { success: boolean; content: string; error?: string };

export async function gitLog(
  cwd: string, options: { maxCount?: number; file?: string } = {},
): Promise<GitLogResult> {
  const args = ["log", `--max-count=${options.maxCount ?? 20}`, "--format=%H%n%an%n%ai%n%s%n---"];
  if (options.file) args.push("--", options.file);
  try {
    const { stdout } = await execFileAsync("git", args, { cwd });
    const entries: GitLogEntry[] = [];
    const blocks = stdout.split("---\n").filter((b) => b.trim());
    for (const block of blocks) {
      const lines = block.trim().split("\n");
      if (lines.length >= 4) {
        entries.push({ hash: lines[0], author: lines[1], date: lines[2], message: lines[3] });
      }
    }
    return { success: true, entries };
  } catch (err) {
    return { success: false, entries: [], error: String(err) };
  }
}

export async function gitShow(cwd: string, ref: string): Promise<GitContentResult> {
  try {
    const { stdout } = await execFileAsync("git", ["show", "--stat", ref], { cwd, maxBuffer: 5 * 1024 * 1024 });
    return { success: true, content: stdout };
  } catch (err) {
    return { success: false, content: "", error: String(err) };
  }
}

export async function gitDiff(cwd: string, ref?: string): Promise<GitContentResult> {
  const args = ref ? ["diff", ref] : ["diff"];
  try {
    const { stdout } = await execFileAsync("git", args, { cwd, maxBuffer: 5 * 1024 * 1024 });
    return { success: true, content: stdout };
  } catch (err) {
    return { success: false, content: "", error: String(err) };
  }
}
