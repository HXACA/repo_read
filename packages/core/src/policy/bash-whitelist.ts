const ALLOWED_COMMANDS = new Set([
  "wc", "sort", "uniq", "head", "tail",
  "tree", "file", "stat", "du", "ls",
]);

const FORBIDDEN_PATTERNS = [
  /[>]/, /[`]/, /\$\(/, /[;]/, /&&/, /\|\|/,
];

const FORBIDDEN_COMMANDS = new Set([
  "rm", "mv", "cp", "chmod", "chown", "kill", "sudo",
  "curl", "wget", "cat", "dd", "mkfs", "mount",
  "npm", "npx", "yarn", "pnpm", "pip", "cargo",
  "python", "python3", "node", "ruby", "perl",
  "bash", "sh", "zsh",
]);

export type BashValidationResult = { allowed: boolean; reason?: string };

export function validateBashCommand(command: string): BashValidationResult {
  const trimmed = command.trim();
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { allowed: false, reason: `Forbidden pattern: ${pattern.source}` };
    }
  }
  const segments = trimmed.split("|").map((s) => s.trim());
  for (const segment of segments) {
    const parts = segment.split(/\s+/);
    const cmd = parts[0];
    if (!cmd) return { allowed: false, reason: "Empty command segment" };
    if (FORBIDDEN_COMMANDS.has(cmd)) return { allowed: false, reason: `Forbidden command: ${cmd}` };
    if (!ALLOWED_COMMANDS.has(cmd)) return { allowed: false, reason: `Command not in whitelist: ${cmd}` };
  }
  return { allowed: true };
}
