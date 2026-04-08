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

  // Redirect to latest version if available
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
        No published versions yet. Run <code className="rounded bg-gray-100 px-1 dark:bg-gray-800">repo-read generate</code> to create one.
      </p>
    </main>
  );
}
