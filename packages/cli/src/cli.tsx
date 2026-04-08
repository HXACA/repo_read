import { Command } from "commander";
import { runInit } from "./commands/init.js";

export function createProgram(): Command {
  const program = new Command();

  program
    .name("repo-read")
    .description("Local-first code reading & technical writing workbench")
    .version("0.1.0");

  program
    .command("init")
    .description("Initialize a new RepoRead project")
    .option("-d, --dir <path>", "Repository root directory", process.cwd())
    .option("-n, --name <slug>", "Project slug name")
    .action(async (opts) => {
      await runInit({ repoRoot: opts.dir, projectSlug: opts.name });
    });

  program
    .command("providers")
    .description("Manage LLM provider credentials and role model mappings")
    .action(() => {
      console.log("repo-read providers — not yet implemented");
    });

  return program;
}
