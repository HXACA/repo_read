import * as fs from "node:fs/promises";
import * as path from "node:path";
import { StorageAdapter, ProjectModel } from "@reporead/core";
import type { GenerationJob } from "@reporead/core";
import { notFound } from "next/navigation";
import { GenerateClient } from "./generate-client";

async function getData(slug: string) {
  const repoRoot = process.env.REPOREAD_ROOT ?? process.cwd();
  const storage = new StorageAdapter(repoRoot);
  const projectModel = new ProjectModel(storage);
  const project = await projectModel.get(slug);
  if (!project) return null;

  const jobsDir = path.join(storage.paths.projectDir(slug), "jobs");
  const jobs: GenerationJob[] = [];
  try {
    const dirs = await fs.readdir(jobsDir);
    for (const dir of dirs) {
      try {
        const raw = await fs.readFile(
          path.join(jobsDir, dir, "job-state.json"),
          "utf-8",
        );
        jobs.push(JSON.parse(raw));
      } catch {
        continue;
      }
    }
  } catch {
    /* no jobs dir */
  }

  jobs.sort(
    (a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  return { project, jobs };
}

export default async function GenerateWorkbench({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const data = await getData(slug);
  if (!data) notFound();

  const serialJobs = data.jobs.map((j) => ({
    id: j.id,
    status: j.status,
    versionId: j.versionId,
    createdAt: j.createdAt,
    totalPages: j.summary.totalPages ?? null,
    succeededPages: j.summary.succeededPages ?? 0,
    lastError: j.lastError ?? null,
  }));

  return (
    <GenerateClient
      slug={slug}
      repoRoot={data.project.repoRoot}
      jobs={serialJobs}
    />
  );
}
