import Link from "next/link";
import { StorageAdapter, EventReader } from "@reporead/core";
import type { GenerationJob, AppEvent } from "@reporead/core";
import { notFound } from "next/navigation";

async function getJobData(slug: string, jobId: string) {
  const repoRoot = process.env.REPOREAD_ROOT ?? process.cwd();
  const storage = new StorageAdapter(repoRoot);

  const job = await storage.readJson<GenerationJob>(
    storage.paths.jobStateJson(slug, jobId),
  );
  if (!job) return null;

  const reader = new EventReader(storage.paths.eventsNdjson(slug, jobId));
  const events = await reader.readAll();

  return { job, events };
}

function eventIcon(type: string): string {
  if (type.includes("started")) return "▶";
  if (type.includes("completed")) return "✓";
  if (type.includes("failed")) return "✗";
  if (type.includes("interrupted")) return "⏸";
  if (type.includes("resumed")) return "▶";
  if (type.includes("drafting")) return "✎";
  if (type.includes("drafted")) return "✎";
  if (type.includes("reviewed")) return "⊘";
  if (type.includes("validated")) return "✓";
  return "·";
}

function statusBadge(status: string): string {
  switch (status) {
    case "completed": return "rounded bg-green-100 px-2 py-0.5 text-green-700 dark:bg-green-900 dark:text-green-300";
    case "failed": return "rounded bg-red-100 px-2 py-0.5 text-red-700 dark:bg-red-900 dark:text-red-300";
    case "interrupted": return "rounded bg-yellow-100 px-2 py-0.5 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300";
    default: return "rounded bg-blue-100 px-2 py-0.5 text-blue-700 dark:bg-blue-900 dark:text-blue-300";
  }
}

export default async function JobDetailsPage({
  params,
}: {
  params: Promise<{ slug: string; jobId: string }>;
}) {
  const { slug, jobId } = await params;
  const data = await getJobData(slug, jobId);
  if (!data) notFound();

  const { job, events } = data;

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <nav className="mb-6 text-sm text-gray-500">
        <Link href="/" className="hover:text-blue-600">Home</Link>
        {" / "}
        <Link href={`/projects/${slug}/generate`} className="hover:text-blue-600">{slug}</Link>
        {" / "}
        <span>Job {jobId.slice(0, 8)}</span>
      </nav>

      <div className="flex items-center gap-4">
        <h1 className="text-2xl font-bold">Job {jobId.slice(0, 8)}</h1>
        <span className={`text-sm font-medium ${statusBadge(job.status)}`}>
          {job.status}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
        <div>
          <span className="text-gray-500">Version</span>
          <p className="font-medium">{job.versionId}</p>
        </div>
        <div>
          <span className="text-gray-500">Created</span>
          <p className="font-medium">{new Date(job.createdAt).toLocaleString()}</p>
        </div>
        {job.summary.totalPages != null && (
          <div>
            <span className="text-gray-500">Pages</span>
            <p className="font-medium">{job.summary.succeededPages ?? 0} / {job.summary.totalPages}</p>
          </div>
        )}
        {job.currentPageSlug && (
          <div>
            <span className="text-gray-500">Current Page</span>
            <p className="font-medium">{job.currentPageSlug}</p>
          </div>
        )}
      </div>

      {job.lastError && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {job.lastError}
        </div>
      )}

      {job.status === "completed" && (
        <div className="mt-4">
          <Link
            href={`/projects/${slug}/versions/${job.versionId}`}
            className="inline-block rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            View Published Version
          </Link>
        </div>
      )}

      <section className="mt-8">
        <h2 className="text-xl font-semibold">Event Timeline</h2>
        {events.length === 0 ? (
          <p className="mt-4 text-gray-400">No events recorded.</p>
        ) : (
          <ol className="mt-4 space-y-1">
            {events.map((event: AppEvent) => (
              <li key={event.id} className="flex items-start gap-3 py-2 text-sm">
                <span className="w-5 text-center font-mono">{eventIcon(event.type)}</span>
                <span className="w-40 shrink-0 font-mono text-gray-400">
                  {new Date(event.at).toLocaleTimeString()}
                </span>
                <span className="font-medium">{event.type}</span>
                {event.pageSlug && (
                  <span className="text-gray-500">({event.pageSlug})</span>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}
