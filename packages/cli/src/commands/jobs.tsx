import * as path from "node:path";
import * as fs from "node:fs/promises";
import { StorageAdapter } from "@reporead/core";
import type { GenerationJob } from "@reporead/core";

export interface JobsOptions {
  dir: string;
  name?: string;
}

export async function runJobs(options: JobsOptions): Promise<void> {
  const repoRoot = path.resolve(options.dir);
  const slug = options.name ?? path.basename(repoRoot);
  const storage = new StorageAdapter(repoRoot);

  const projectDir = storage.paths.projectDir(slug);
  const jobsDir = path.join(projectDir, "jobs");

  let jobDirs: string[];
  try {
    jobDirs = await fs.readdir(jobsDir);
  } catch {
    console.log(`No jobs found for project "${slug}".`);
    return;
  }

  const jobs: GenerationJob[] = [];
  for (const dir of jobDirs) {
    const statePath = path.join(jobsDir, dir, "job-state.json");
    try {
      const raw = await fs.readFile(statePath, "utf-8");
      jobs.push(JSON.parse(raw) as GenerationJob);
    } catch {
      // Skip invalid job directories
    }
  }

  if (jobs.length === 0) {
    console.log(`No jobs found for project "${slug}".`);
    return;
  }

  // Sort by createdAt descending
  jobs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  console.log(`Jobs for "${slug}":\n`);
  for (const job of jobs) {
    const status = job.status.padEnd(12);
    const version = job.versionId;
    const pages = job.summary.totalPages
      ? `${job.summary.succeededPages ?? 0}/${job.summary.totalPages} pages`
      : "";
    const date = new Date(job.createdAt).toLocaleDateString();
    console.log(`  ${job.id.slice(0, 8)}  ${status}  ${version}  ${pages}  ${date}`);
    if (job.lastError) {
      console.log(`           Error: ${job.lastError}`);
    }
  }
}
