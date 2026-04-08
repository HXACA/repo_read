import Link from "next/link";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { StorageAdapter, ProjectModel } from "@reporead/core";
import type { GenerationJob } from "@reporead/core";
import { notFound } from "next/navigation";

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
        const raw = await fs.readFile(path.join(jobsDir, dir, "job-state.json"), "utf-8");
        jobs.push(JSON.parse(raw));
      } catch { continue; }
    }
  } catch { /* no jobs dir */ }

  jobs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return { project, jobs };
}

function statusColor(status: string): string {
  switch (status) {
    case "completed": return "text-green-600 dark:text-green-400";
    case "failed": return "text-red-600 dark:text-red-400";
    case "interrupted": return "text-yellow-600 dark:text-yellow-400";
    default: return "text-blue-600 dark:text-blue-400";
  }
}

export default async function GenerateWorkbench({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const data = await getData(slug);
  if (!data) notFound();

  const { project, jobs } = data;

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <nav className="mb-6 text-sm text-gray-500">
        <Link href="/" className="hover:text-blue-600">Home</Link>
        {" / "}
        <span>{slug}</span>
        {" / "}
        <span>Generate</span>
      </nav>

      <h1 className="text-3xl font-bold">Generate Wiki</h1>
      <p className="mt-2 text-gray-500 dark:text-gray-400">
        {project.repoRoot}
      </p>

      <div className="mt-6 rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900">
        <p className="text-sm text-gray-600 dark:text-gray-300">
          To start generation, run from your terminal:
        </p>
        <code className="mt-2 block rounded bg-gray-100 p-3 text-sm dark:bg-gray-800">
          repo-read generate -d {project.repoRoot}
        </code>
      </div>

      <section className="mt-8">
        <h2 className="text-xl font-semibold">Recent Jobs</h2>
        {jobs.length === 0 ? (
          <p className="mt-4 text-gray-400">No generation jobs yet.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {jobs.map((job) => (
              <li key={job.id}>
                <Link
                  href={`/projects/${slug}/jobs/${job.id}`}
                  className="block rounded-lg border border-gray-200 p-4 hover:border-blue-400 dark:border-gray-700 dark:hover:border-blue-500"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-sm">{job.id.slice(0, 8)}</span>
                    <span className={`text-sm font-medium ${statusColor(job.status)}`}>
                      {job.status}
                    </span>
                  </div>
                  <div className="mt-2 flex gap-4 text-xs text-gray-500">
                    <span>Version: {job.versionId}</span>
                    {job.summary.totalPages != null && (
                      <span>
                        Pages: {job.summary.succeededPages ?? 0}/{job.summary.totalPages}
                      </span>
                    )}
                    <span>{new Date(job.createdAt).toLocaleString()}</span>
                  </div>
                  {job.lastError && (
                    <p className="mt-2 text-xs text-red-500">{job.lastError}</p>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
