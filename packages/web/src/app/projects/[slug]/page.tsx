import Link from "next/link";
import { StorageAdapter, ProjectModel } from "@reporead/core";
import { notFound, redirect } from "next/navigation";

async function getProject(slug: string) {
  const repoRoot = process.env.REPOREAD_ROOT ?? process.cwd();
  const storage = new StorageAdapter(repoRoot);
  const projectModel = new ProjectModel(storage);
  return projectModel.get(slug);
}

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const project = await getProject(slug);

  if (!project) notFound();

  if (project.latestVersionId) {
    redirect(`/projects/${slug}/versions/${project.latestVersionId}`);
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <nav className="mb-6 text-sm text-gray-500">
        <Link href="/" className="hover:text-blue-600">Home</Link>
        {" / "}
        <span>{slug}</span>
      </nav>

      <h1 className="text-3xl font-bold">{slug}</h1>
      <p className="mt-4 text-gray-500">
        No published versions yet.
      </p>
      <div className="mt-4 flex gap-3">
        <Link
          href={`/projects/${slug}/generate`}
          className="inline-block rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          View Generate Status
        </Link>
      </div>
      <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900">
        <p className="text-sm text-gray-600 dark:text-gray-300">
          Run from terminal:
        </p>
        <code className="mt-2 block rounded bg-gray-100 p-3 text-sm dark:bg-gray-800">
          repo-read generate -d {project.repoRoot}
        </code>
      </div>
    </main>
  );
}
