import { exec } from "node:child_process";
import { promisify } from "node:util";
import { validateBashCommand } from "../policy/bash-whitelist.js";

const execAsync = promisify(exec);
const BASH_TIMEOUT = 30_000;

export type BashResult = { success: boolean; output: string; error?: string };

export async function execBash(cwd: string, command: string): Promise<BashResult> {
  const validation = validateBashCommand(command);
  if (!validation.allowed) {
    return { success: false, output: "", error: `Command not in whitelist: ${validation.reason}` };
  }
  try {
    const { stdout, stderr } = await execAsync(command, { cwd, timeout: BASH_TIMEOUT, maxBuffer: 5 * 1024 * 1024 });
    return { success: true, output: stdout + (stderr ? `\n[stderr]: ${stderr}` : "") };
  } catch (err) {
    const error = err as { stdout?: string; stderr?: string; message?: string };
    return { success: false, output: error.stdout ?? "", error: error.stderr ?? error.message ?? String(err) };
  }
}
