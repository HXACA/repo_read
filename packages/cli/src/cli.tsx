import { Command } from "commander";
import { runInit } from "./commands/init.js";
import { runGenerate } from "./commands/generate.js";
import { runBrowse } from "./commands/browse.js";
import { runJobs } from "./commands/jobs.js";
import { runVersions } from "./commands/versions.js";
import { runAsk } from "./commands/ask.js";
import { runResearch } from "./commands/research.js";
import { runDoctor } from "./commands/doctor.js";

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
    .command("generate")
    .description("Generate wiki pages for a project")
    .option("-d, --dir <path>", "Repository root directory", process.cwd())
    .option("-n, --name <slug>", "Project slug name")
    .option(
      "--resume <jobId>",
      "Resume a previously failed or interrupted job, skipping pages that were already validated",
    )
    .option("--debug", "Log full model request/response pairs to .reporead/debug/")
    .option("--incremental", "Only regenerate pages affected by changed files (not yet implemented)", false)
    .action(async (opts) => {
      if (opts.debug) process.env.REPOREAD_DEBUG = "1";
      await runGenerate({
        dir: opts.dir,
        name: opts.name,
        resume: opts.resume,
        incremental: opts.incremental,
      });
    });

  program
    .command("browse")
    .description("Open the wiki reader in your browser")
    .option("-d, --dir <path>", "Repository root directory", process.cwd())
    .option("-n, --name <slug>", "Project slug name")
    .option("-p, --port <port>", "Web server port", "3000")
    .option("--page <slug>", "Jump to a specific page")
    .action(async (opts) => {
      await runBrowse({ dir: opts.dir, name: opts.name, port: opts.port, page: opts.page });
    });

  program
    .command("jobs")
    .description("List generation jobs for a project")
    .option("-d, --dir <path>", "Repository root directory", process.cwd())
    .option("-n, --name <slug>", "Project slug name")
    .action(async (opts) => {
      await runJobs({ dir: opts.dir, name: opts.name });
    });

  program
    .command("versions")
    .description("List published versions for a project")
    .option("-d, --dir <path>", "Repository root directory", process.cwd())
    .option("-n, --name <slug>", "Project slug name")
    .action(async (opts) => {
      await runVersions({ dir: opts.dir, name: opts.name });
    });

  program
    .command("ask")
    .description("Ask questions about the codebase wiki")
    .option("-d, --dir <path>", "Repository root directory", process.cwd())
    .option("-n, --name <slug>", "Project slug name")
    .option("-p, --page <slug>", "Current page context")
    .option("-q, --question <text>", "Single question (non-interactive)")
    .action(async (opts) => {
      await runAsk({ dir: opts.dir, name: opts.name, page: opts.page, question: opts.question });
    });

  program
    .command("research")
    .description("Deep research on a codebase topic")
    .requiredOption("-t, --topic <text>", "Research topic")
    .option("-d, --dir <path>", "Repository root directory", process.cwd())
    .option("-n, --name <slug>", "Project slug name")
    .action(async (opts) => {
      await runResearch({ dir: opts.dir, name: opts.name, topic: opts.topic });
    });

  program
    .command("doctor")
    .description("Diagnose environment, config, and project health")
    .option("-d, --dir <path>", "Repository root directory", process.cwd())
    .option("-n, --name <slug>", "Project slug name")
    .action(async (opts) => {
      await runDoctor({ dir: opts.dir, name: opts.name });
    });

  program
    .command("providers")
    .description("Manage LLM provider credentials and role model mappings")
    .action(() => {
      console.log("repo-read providers — not yet implemented");
    });

  return program;
}
