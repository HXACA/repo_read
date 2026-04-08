import { Command } from "commander";

export function createProgram(): Command {
  const program = new Command();

  program
    .name("repo-read")
    .description("Local-first code reading & technical writing workbench")
    .version("0.1.0");

  program
    .command("init")
    .description("Initialize a new RepoRead project in the current directory")
    .action(() => {
      console.log("repo-read init — not yet implemented");
    });

  program
    .command("providers")
    .description("Manage LLM provider credentials and role model mappings")
    .action(() => {
      console.log("repo-read providers — not yet implemented");
    });

  return program;
}
