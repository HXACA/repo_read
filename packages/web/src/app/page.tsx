import Link from "next/link";
import { StorageAdapter, ProjectModel } from "@reporead/core";

async function getProjects() {
  const repoRoot = process.env.REPOREAD_ROOT ?? process.cwd();
  const storage = new StorageAdapter(repoRoot);
  const projectModel = new ProjectModel(storage);
  try {
    return await projectModel.list();
  } catch {
    return [];
  }
}

export default async function HomePage() {
  const projects = await getProjects();

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <h1 className="text-3xl font-bold">RepoRead</h1>
      <p className="mt-2 text-gray-500 dark:text-gray-400">
        Local-first code reading &amp; technical writing workbench
      </p>

      <section className="mt-8">
        <h2 className="text-xl font-semibold">Projects</h2>
        {projects.length === 0 ? (
          <p className="mt-4 text-gray-400">
            No projects found. Run <code className="rounded bg-gray-100 px-1 dark:bg-gray-800">repo-read init</code> to create one.
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {projects.map((p) => (
              <li key={p.projectSlug}>
                <Link
                  href={p.latestVersionId
                    ? `/projects/${p.projectSlug}/versions/${p.latestVersionId}`
                    : `/projects/${p.projectSlug}`}
                  className="block rounded-lg border border-gray-200 p-4 hover:border-blue-400 hover:bg-blue-50 dark:border-gray-700 dark:hover:border-blue-500 dark:hover:bg-gray-900"
                >
                  <h3 className="font-semibold">{p.projectSlug}</h3>
                  <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                    {p.repoRoot}
                  </p>
                  {p.latestVersionId && (
                    <span className="mt-2 inline-block text-xs text-blue-600 dark:text-blue-400">
                      Latest: {p.latestVersionId}
                    </span>
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
