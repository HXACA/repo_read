import { StorageAdapter, EventReader } from "@reporead/core";
import type { GenerationJob, AppEvent } from "@reporead/core";
import { notFound } from "next/navigation";
import { JobClient } from "./job-client";

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

export default async function JobDetailsPage({
  params,
}: {
  params: Promise<{ slug: string; jobId: string }>;
}) {
  const { slug, jobId } = await params;
  const data = await getJobData(slug, jobId);
  if (!data) notFound();

  const serialEvents = data.events.map((e: AppEvent) => ({
    id: e.id,
    type: e.type,
    at: e.at,
    pageSlug: e.pageSlug ?? null,
  }));

  return (
    <JobClient
      slug={slug}
      jobId={jobId}
      status={data.job.status}
      versionId={data.job.versionId}
      createdAt={data.job.createdAt}
      totalPages={data.job.summary.totalPages ?? null}
      succeededPages={data.job.summary.succeededPages ?? 0}
      currentPageSlug={data.job.currentPageSlug ?? null}
      lastError={data.job.lastError ?? null}
      events={serialEvents}
    />
  );
}
