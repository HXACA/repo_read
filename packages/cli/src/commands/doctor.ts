import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import { StorageAdapter, ProjectModel, loadProjectConfig, resolveApiKeys } from "@reporead/core";
import type { UserEditableConfig } from "@reporead/core";

export interface DoctorOptions {
  dir: string;
  name?: string;
}

export async function runDoctor(options: DoctorOptions): Promise<void> {
  const repoRoot = path.resolve(options.dir);
  let hasError = false;

  const ok = (msg: string) => console.log(`  \u2713 ${msg}`);
  const warn = (msg: string) => {
    console.log(`  \u26A0 ${msg}`);
  };
  const fail = (msg: string) => {
    console.log(`  \u2717 ${msg}`);
    hasError = true;
  };

  // --- Environment ---
  console.log("\n  Environment");
  const nodeVer = process.version;
  const major = parseInt(nodeVer.slice(1));
  if (major >= 22) ok(`Node.js ${nodeVer}`);
  else fail(`Node.js ${nodeVer} (need \u226522)`);

  try {
    const { execSync } = await import("node:child_process");
    const gitVer = execSync("git --version", { encoding: "utf-8" }).trim();
    ok(gitVer);
  } catch {
    fail("git not found");
  }

  // --- Global Config ---
  console.log("\n  Global Config");
  const globalPath = path.join(os.homedir(), ".reporead", "config.json");
  try {
    const raw = await fs.readFile(globalPath, "utf-8");
    const gc = JSON.parse(raw) as Partial<UserEditableConfig>;
    ok(`${globalPath} found`);
    if (gc.providers) {
      const gcConfig = { projectSlug: "", repoRoot: "", preset: "default", providers: gc.providers, roles: {} } as unknown as UserEditableConfig;
      const gcKeys = resolveApiKeys(gcConfig);
      for (const p of gc.providers) {
        if (!p.enabled) continue;
        if (gcKeys[p.provider]) ok(`Provider: ${p.provider} (API key set)`);
        else warn(`Provider: ${p.provider} (no API key \u2014 set ${p.secretRef} or add apiKey to config)`);
      }
    }
  } catch {
    warn(`${globalPath} not found (optional)`);
  }

  // --- Project ---
  const storage = new StorageAdapter(repoRoot);
  const projectModel = new ProjectModel(storage);
  const slug = options.name ?? path.basename(repoRoot);

  console.log(`\n  Project: ${slug}`);
  const project = await projectModel.get(slug);
  if (!project) {
    fail(`Project "${slug}" not found. Run "repo-read init" first.`);
    if (hasError) process.exitCode = 1;
    console.log();
    return;
  }
  ok("Project registered");

  // Project config
  try {
    const config = await loadProjectConfig(storage.paths.projectDir(slug));
    ok("Config valid");
    // Check project providers
    const apiKeys = resolveApiKeys(config);
    for (const p of config.providers) {
      if (!p.enabled) continue;
      if (apiKeys[p.provider]) ok(`Provider: ${p.provider} (API key set)`);
      else warn(`Provider: ${p.provider} (no API key \u2014 set ${p.secretRef} or add apiKey to config)`);
    }
  } catch {
    fail("Config invalid or missing");
  }

  // --- Jobs ---
  console.log(`\n  Jobs`);
  const jobsDir = path.join(storage.paths.projectDir(slug), "jobs");
  try {
    const jobDirs = await fs.readdir(jobsDir);
    let incompleteCount = 0;
    for (const jobId of jobDirs) {
      const statePath = path.join(jobsDir, jobId, "job-state.json");
      try {
        const raw = await fs.readFile(statePath, "utf-8");
        const state = JSON.parse(raw);
        if (state.status === "completed") continue;
        incompleteCount++;
        const age =
          Date.now() -
          new Date(state.updatedAt ?? state.createdAt ?? 0).getTime();
        const days = Math.floor(age / 86400000);
        const ageStr = days > 0 ? `${days}d old` : "recent";
        const short = jobId.slice(0, 8);
        if (days > 7) {
          warn(
            `Stale job ${short} (status=${state.status}, ${ageStr})`,
          );
        } else {
          warn(
            `Incomplete job ${short} (status=${state.status}, ${ageStr})`,
          );
        }
        console.log(
          `    Resume: repo-read generate -d ${repoRoot} --resume ${jobId}`,
        );
      } catch {
        /* skip unreadable */
      }
    }
    if (incompleteCount === 0) ok("No incomplete jobs");
  } catch {
    ok("No jobs yet");
  }

  console.log();
  if (hasError) process.exitCode = 1;
}
